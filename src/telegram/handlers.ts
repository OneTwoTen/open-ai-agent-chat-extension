import type { Bot } from "grammy";
import * as path from "path";
import * as vscode from "vscode";
import type { GrammyContext, TelegramChatSession } from "./types";
import { createTelegramCallbacks } from "./callbacks";
import { createTelegramToolContext } from "./toolContext";
import { AgentManager } from "../agent/agents";
import { SkillManager, loadProjectRules } from "../agent/skills";
import { MemoryStore } from "../agent/memory";
import { RepoIndex } from "../agent/embeddings";
import { McpManager } from "../agent/mcp";
import { resolveAgentchatDir } from "../agent/dataPath";
import { buildTools } from "../agent/tools";
import { composeSystemPrompt } from "../agent/prompt";
import {
  buildRequestProviderOptions,
  buildSystemMessage,
  maxOutputTokensFor,
} from "../agent/providerTuning";
import {
  getActiveModel,
  getActiveProviderId,
  getActiveModelId,
  getModelFor,
  getEmbeddingModel,
  PROVIDERS,
} from "../providers";
import type { TelegramSessionManager } from "./session";
import type { PermissionLevel, Attachment, TranscriptItem, UsageStats } from "../shared/protocol";
import { SessionStore, titleFrom } from "../sessions";
import { eventBus } from "../shared/eventBus";

export function parseConfirmCallbackData(data: string): { key: string; chatId: number; value: boolean } | null {
  if (!data.startsWith("confirm:")) {
    return null;
  }
  const body = data.slice("confirm:".length);
  const lastColon = body.lastIndexOf(":");
  if (lastColon <= 0) {
    return null;
  }
  const key = body.slice(0, lastColon);
  const action = body.slice(lastColon + 1);
  if (action !== "yes" && action !== "no") {
    return null;
  }
  const firstColon = key.indexOf(":");
  const chatIdText = firstColon === -1 ? key : key.slice(0, firstColon);
  const chatId = Number(chatIdText);
  if (!Number.isFinite(chatId)) {
    return null;
  }
  return { key, chatId, value: action === "yes" };
}

interface QueuedRequest {
  text: string;
  attachments: Attachment[];
  resolve: () => void;
}

export function runInBackground(label: string, runner: () => Promise<void>): void {
  runner().catch((err) => {
    log("error", `${label} failed`, err);
  });
}

// ── Helpers ──────────────────────────────────────────────────────

function log(level: "info" | "warn" | "error", msg: string, data?: unknown): void {
  const prefix = `[TelegramBot ${level}]`;
  if (level === "error") {
    console.error(prefix, msg, data ?? "");
  } else if (level === "warn") {
    console.warn(prefix, msg, data ?? "");
  } else {
    console.log(prefix, msg, data ?? "");
  }
}

async function downloadTelegramFile(
  bot: Bot<GrammyContext>,
  fileId: string,
): Promise<{ buffer: Buffer; ext: string; mimeType: string } | null> {
  try {
    const file = await bot.api.getFile(fileId);
    if (!file.file_path) return null;
    const ext = path.extname(file.file_path) || ".bin";
    const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buffer = Buffer.from(await resp.arrayBuffer());
    const mimeType = resp.headers.get("content-type") || "application/octet-stream";
    return { buffer, ext, mimeType };
  } catch (err) {
    log("warn", "Failed to download Telegram file", err);
    return null;
  }
}

function escapeTg(text: string): string {
  return text
    .replace(/_/g, "\\_")
    .replace(/\*/g, "\\*")
    .replace(/\[/g, "\\[")
    .replace(/`/g, "\\`")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

// ── Agent turn runner ────────────────────────────────────────────

export async function runAgentTurn(
  bot: Bot<GrammyContext>,
  chatId: number,
  text: string,
  sessions: TelegramSessionManager,
  secrets: vscode.SecretStorage,
  attachments: Attachment[],
  defaultWorkspacePath: string,
  storageUri: vscode.Uri,
): Promise<void> {
  const session = sessions.getOrCreate(chatId);

  // Resolve workspace path: per-chat override > config > first workspace folder
  const root = session.workspacePath || defaultWorkspacePath
    || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!root) {
    await bot.api.sendMessage(
      chatId,
      "❌ No workspace folder is configured.\n\n"
      + "Options:\n"
      + "• Open a folder in VS Code\n"
      + "• Set `aiAgentChat.telegram.workspacePath` in VS Code settings\n"
      + "• Use `/workspace` to list and select available workspaces",
    );
    return;
  }

  // Queue system: if a request is running, queue this one
  if (session.state === "running") {
    await bot.api.sendMessage(chatId, "⏳ Another request is running — waiting in queue.");
    return new Promise<void>((resolve) => {
      if (!session.queue) session.queue = [];
      session.queue.push({ text, attachments, resolve } as QueuedRequest);
    });
  }

  session.state = "running";
  session.streamingMessageId = null;
  session.streamingText = "";
  session.abortController = new AbortController();

  // Assign a persistent session id on first turn
  if (!session.sessionId) {
    session.sessionId = new SessionStore(storageUri).newId();
  }

  log("info", `Starting turn for chat ${chatId}`, { agentId: session.agentId, textLen: text.length });

  // Emit message received event
  eventBus.emit("telegram:activity", {
    type: "messageReceived",
    chatId,
    timestamp: Date.now(),
    data: { text: text.slice(0, 200), agentId: session.agentId, hasAttachments: attachments.length > 0 },
  });

  // Build workspace services
  const agents = new AgentManager(root);
  const skills = new SkillManager(root);
  const memory = new MemoryStore(root);
  const index = new RepoIndex(
    vscode.Uri.file(path.join(resolveAgentchatDir(root), "repo-index.json")),
    () => getEmbeddingModel(secrets),
  );
  const mcp = new McpManager(root);

  try {
    await bot.api.sendChatAction(chatId, "typing");

    const agent = (await agents.get(session.agentId)) ?? (await agents.list())[0];
    const providerId = (agent.provider ?? getActiveProviderId()) as import("../providers/catalog").ProviderId;
    const modelId = agent.model?.trim()
      || (agent.provider ? PROVIDERS[providerId].defaultModel : getActiveModelId(providerId));

    const model = agent.provider
      ? await getModelFor(providerId, modelId, secrets)
      : (await getActiveModel(secrets)).model;

    const [projectRules, memoryText, alwaysSkills] = await Promise.all([
      loadProjectRules(root).catch(() => ""),
      memory.read(),
      skills.alwaysApplyText(),
    ]);

    let extraSkills = "";
    if (agent.skills && agent.skills.length > 0) {
      const parts: string[] = [];
      for (const name of agent.skills) {
        const skill = await skills.get(name);
        if (skill) {
          parts.push(`<skill name="${skill.name}">\n${skill.body}\n</skill>`);
        }
      }
      extraSkills = parts.join("\n\n");
    }

    const systemText = composeSystemPrompt({
      agent,
      projectRules,
      memory: memoryText,
      skills: [alwaysSkills, extraSkills].filter(Boolean).join("\n\n"),
    });

    const systemMessage = buildSystemMessage(systemText, providerId);
    const providerOptions = buildRequestProviderOptions(providerId, modelId, "off" as any);
    const maxOutput = maxOutputTokensFor(providerId, modelId, "off" as any);

    const permission = vscode.workspace.getConfiguration("aiAgentChat")
      .get<PermissionLevel>("permission", "ask");

    const allowExternalFiles = vscode.workspace.getConfiguration("aiAgentChat")
      .get<boolean>("allowExternalFiles", false);

    // Connect MCP (non-fatal if fails)
    try {
      await mcp.connectAll();
    } catch (e) {
      log("warn", "MCP connection failed", e);
    }

    const toolCtx = createTelegramToolContext(
      bot, chatId, sessions, root,
      permission,
      allowExternalFiles,
      index, memory, skills,
    );

    if (agent.subAgents && agent.subAgents.length > 0) {
      toolCtx.allowedSubAgents = agent.subAgents;
      toolCtx.delegate = async (subAgentId: string, task: string) => {
        await bot.api.sendMessage(chatId, `↳ Delegating to ${subAgentId}…`);
        await runAgentTurn(bot, chatId, task, sessions, secrets, [], defaultWorkspacePath, storageUri);
        return "(sub-agent completed)";
      };
    }

    const tools = { ...buildTools(toolCtx, agent.tools), ...mcp.getTools() };

    // Track transcript items for persistence
    const transcript: TranscriptItem[] = [];
    let openAssistant: { kind: "assistant"; text: string; model?: string } | null = null;
    const toolIndexById = new Map<string, number>();

    const appendAssistant = (t: string) => {
      if (openAssistant) {
        openAssistant.text += t;
      } else {
        openAssistant = { kind: "assistant", text: t, model: turnLabel };
        transcript.push(openAssistant);
      }
    };

    const turnLabel = `${agent.name} · ${providerId}/${modelId}`;

    const callbacks = createTelegramCallbacks(
      bot, chatId,
      () => session.streamingMessageId,
      (id) => { session.streamingMessageId = id; },
      () => session.streamingText,
      (t) => { session.streamingText = t; },
    );

    // Wrap callbacks to also track transcript
    const wrappedCallbacks: import("../agent/agent").AgentCallbacks = {
      onTextDelta: (t: string) => {
        callbacks.onTextDelta(t);
        appendAssistant(t);
      },
      onReasoningDelta: (t: string) => {
        callbacks.onReasoningDelta(t);
      },
      onToolCall: (id: string, name: string, args: unknown) => {
        callbacks.onToolCall(id, name, args);
        openAssistant = null;
        toolIndexById.set(id, transcript.length);
        transcript.push({ kind: "tool", id, name, args });
      },
      onToolResult: (id: string, name: string, result: unknown) => {
        callbacks.onToolResult(id, name, result);
        const idx = toolIndexById.get(id);
        if (idx !== undefined) {
          const item = transcript[idx];
          if (item.kind === "tool") {
            item.result = typeof result === "string" ? result : JSON.stringify(result);
          }
        }
      },
      onStepUsage: (tools: string[], usage: UsageStats) => {
        callbacks.onStepUsage(tools, usage);
      },
      onFinalUsage: (usage: UsageStats) => {
        callbacks.onFinalUsage(usage);
      },
      onError: (message: string) => {
        callbacks.onError(message);
        transcript.push({ kind: "error", text: message });
      },
      onDone: () => {
        callbacks.onDone();
      },
    };

    const maxSteps = vscode.workspace.getConfiguration("aiAgentChat").get<number>("maxAgentSteps", 25);

    // Build user text with file context
    let userText = text;
    if (attachments.length > 0) {
      const blocks = attachments
        .map((a) => {
          if (a.imageUrl) {
            return `[Image attachment: ${a.path}]`;
          }
          return `File: ${a.path}\n\`\`\`\n${a.content}\n\`\`\``;
        })
        .join("\n\n");
      userText = `${text}\n\nAttached context:\n${blocks}`;
    }

    // Add user message to transcript
    transcript.push({ kind: "user", text, attachments: attachments.map((a) => a.path) });

    // Emit turn started event
    eventBus.emit("telegram:activity", {
      type: "turnStarted",
      chatId,
      timestamp: Date.now(),
      data: { agentId: session.agentId, providerId, modelId, turnLabel },
    });

    await session.agentSession.run({
      model,
      systemMessage,
      tools,
      userText,
      maxSteps,
      maxOutputTokens: maxOutput,
      providerOptions,
      signal: session.abortController!.signal,
      callbacks: wrappedCallbacks,
      timeoutMs: vscode.workspace.getConfiguration("aiAgentChat").get<number>("modelCallTimeoutMs", 600_000),
      maxConsecutiveIdentical: vscode.workspace.getConfiguration("aiAgentChat").get<number>("maxConsecutiveIdenticalToolCalls", 3),
      maxPatternBuffer: vscode.workspace.getConfiguration("aiAgentChat").get<number>("maxPatternBufferSize", 20),
      maxHistoryPerTool: vscode.workspace.getConfiguration("aiAgentChat").get<number>("maxHistoryPerTool", 20),
      burnRateWindow: vscode.workspace.getConfiguration("aiAgentChat").get<number>("toolBurnRateWindow", 5),
      burnRateThreshold: vscode.workspace.getConfiguration("aiAgentChat").get<number>("toolBurnRateThreshold", 3.0),
      frequencyWindowMs: vscode.workspace.getConfiguration("aiAgentChat").get<number>("toolFrequencyWindowMs", 60_000),
      maxCallsPerWindow: vscode.workspace.getConfiguration("aiAgentChat").get<number>("maxToolCallsPerWindow", 15),
      maxConsecutiveSimilarReasoning: vscode.workspace.getConfiguration("aiAgentChat").get<number>("maxConsecutiveSimilarReasoning", 4),
      stepTimeoutMs: vscode.workspace.getConfiguration("aiAgentChat").get<number>("stepTimeoutMs", 120_000),
    });
    await callbacks.flush();

    // Emit turn completed event
    eventBus.emit("telegram:activity", {
      type: "turnCompleted",
      chatId,
      timestamp: Date.now(),
      data: { agentId: session.agentId, transcriptLength: transcript.length },
    });

    // Persist session to SessionStore
    if (transcript.length > 0 && session.sessionId) {
      try {
        const store = new SessionStore(storageUri);
        const firstUser = transcript.find((t) => t.kind === "user") as { text: string } | undefined;
        await store.save({
          id: session.sessionId,
          title: `TG:${chatId} ${titleFrom(firstUser?.text || text || "Chat")}`,
          updatedAt: Date.now(),
          transcript,
          history: session.agentSession.getHistory(),
        });

        // Emit session updated event to refresh UI
        eventBus.emit("telegram:session", {
          type: "sessionUpdated",
          chatId,
          sessionId: session.sessionId,
          agentId: session.agentId,
          timestamp: Date.now(),
        });
      } catch (err) {
        log("warn", "Failed to persist Telegram session", err);
      }
    }

    log("info", `Turn completed for chat ${chatId}`);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    // Emit error event
    eventBus.emit("telegram:activity", {
      type: "error",
      chatId,
      timestamp: Date.now(),
      data: { message: msg.slice(0, 500), agentId: session.agentId },
    });

    if (msg === "Request cancelled.") {
      await bot.api.sendMessage(chatId, "⏹️ Request cancelled.");
    } else if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("API key")) {
      await bot.api.sendMessage(chatId,
        "❌ *API Error:* Invalid or missing API key.\n\n"
        + "Set it in VS Code: `AI Agent: Set Provider API Key`",
        { parse_mode: "Markdown" },
      );
    } else if (msg.includes("rate limit") || msg.includes("429")) {
      await bot.api.sendMessage(chatId, "⏳ Rate limited by the LLM provider. Please wait a moment and try again.");
    } else if (msg.includes("model") && msg.includes("not found")) {
      await bot.api.sendMessage(chatId, `❌ *Model Error:* ${escapeTg(msg.slice(0, 300))}`, { parse_mode: "Markdown" });
    } else {
      await bot.api.sendMessage(chatId, `❌ ${escapeTg(msg.slice(0, 1000))}`);
    }

    log("error", `Turn failed for chat ${chatId}`, msg);

  } finally {
    // Cleanup MCP connections to prevent resource leaks
    await mcp.disposeAll();

    session.state = "idle";

    // Process next queued request
    if (session.queue && session.queue.length > 0) {
      const next = session.queue.shift()!;
      setTimeout(() => {
        runAgentTurn(bot, chatId, next.text, sessions, secrets, next.attachments, defaultWorkspacePath, storageUri)
          .then(() => next.resolve())
          .catch(() => next.resolve());
      }, 300);
    }
  }
}

// ── Command registration ─────────────────────────────────────────

export function registerHandlers(
  bot: Bot<GrammyContext>,
  sessions: TelegramSessionManager,
  secrets: vscode.SecretStorage,
  storageUri: vscode.Uri,
  getWorkspacePath: () => string,
): void {
  // ── /start ──────────────────────────────────────────────────

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "🤖 *AI Agent Chat Bot*\n\n"
      + "I connect you to your VS Code AI coding agents from Telegram.\n\n"
      + "*Commands:*\n"
      + "• `/chat <text>` — Chat with the agent\n"
      + "• `/agent <name>` — Switch agent\n"
      + "• `/workspace` — List / switch workspace\n"
      + "• `/session list|load|delete` — Manage chat history\n"
      + "• `/new` — Start a new conversation\n"
      + "• `/cancel` — Cancel the current request\n"
      + "• `/status` — Show bot and workspace status\n"
      + "• `/help` — Show this message\n\n"
      + "You can also send files and photos as context!",
      { parse_mode: "Markdown" }
    );
  });

  // ── /help ───────────────────────────────────────────────────

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "*Commands:*\n\n"
      + "`/chat <text>` — Send a message to the AI agent\n"
      + "`/agent <name>` — Switch to a different agent\n"
      + "`/workspace` — Show current workspace\n"
      + "`/workspace list` — List available VS Code workspace folders\n"
      + "`/workspace <index>` — Switch to a workspace by number\n"
      + "`/session list` — List saved chat sessions\n"
      + "`/session load <id>` — Load a saved session\n"
      + "`/session delete <id>` — Delete a saved session\n"
      + "`/new` — Clear conversation history\n"
      + "`/cancel` — Cancel the currently running request\n"
      + "`/status` — Show agent, workspace, settings info\n"
      + "`/start` — Show welcome message\n\n"
      + "Send files and photos as attachment context!",
      { parse_mode: "Markdown" }
    );
  });

  // ── /chat ───────────────────────────────────────────────────

  bot.command("chat", async (ctx) => {
    const text = ctx.match?.trim();
    if (!text) {
      await ctx.reply("Usage: `/chat <your message>`", { parse_mode: "Markdown" });
      return;
    }
    runInBackground("Telegram /chat turn", () =>
      runAgentTurn(bot, ctx.chat!.id, text, sessions, secrets, [], getWorkspacePath(), storageUri)
    );
  });

  // ── /agent ──────────────────────────────────────────────────

  bot.command("agent", async (ctx) => {
    const name = ctx.match?.trim().toLowerCase();
    if (!name) {
      await ctx.reply("Usage: `/agent <name>`. Available: coder, ask, architect, orchestrator", { parse_mode: "Markdown" });
      return;
    }
    const root = getWorkspacePath() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const agents = root ? await new AgentManager(root).list() : [];
    const match = agents.find((a) => a.id === name || a.name.toLowerCase() === name);
    if (!match) {
      const list = agents.map((a) => `• \`${a.id}\` — ${a.description}`).join("\n");
      await ctx.reply(`Unknown agent. Available:\n\n${list}`, { parse_mode: "Markdown" });
      return;
    }
    const session = sessions.getOrCreate(ctx.chat!.id);
    session.agentId = match.id;
    await ctx.reply(`✅ Switched to *${match.name}* agent.`, { parse_mode: "Markdown" });
  });

  // ── /workspace ──────────────────────────────────────────────

  bot.command("workspace", async (ctx) => {
    const args = ctx.match?.trim().toLowerCase() || "";
    const session = sessions.getOrCreate(ctx.chat!.id);
    const folders = vscode.workspace.workspaceFolders ?? [];

    if (args === "list") {
      if (folders.length === 0) {
        await ctx.reply("📂 No workspace folders are open in VS Code.");
        return;
      }
      const lines = folders.map((f, i) => {
        const marker = f.uri.fsPath === (session.workspacePath || getWorkspacePath()) ? " ✅ *(active)*" : "";
        return `${i + 1}. \`${f.uri.fsPath}\`${marker}`;
      });
      await ctx.reply(`*Workspace folders:*\n${lines.join("\n")}\n\nUse \`/workspace <number>\` to switch.`, { parse_mode: "Markdown" });
      return;
    }

    if (args === "refresh" || args === "") {
      const current = session.workspacePath || getWorkspacePath() || "(none)";
      const count = folders.length;
      await ctx.reply(
        `📂 *Current workspace:* \`${current}\`\n`
        + `• VS Code has ${count} folder(s) open\n`
        + `• Use \`/workspace list\` to see all\n`
        + `• Use \`/workspace <number>\` to switch\n`
        + `• Per-chat override: ${session.workspacePath ? "`" + session.workspacePath + "`" : "not set (using default)"}`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    // Try to parse as index number (1-based)
    const index = parseInt(args, 10);
    if (!isNaN(index) && index >= 1 && index <= folders.length) {
      const target = folders[index - 1].uri.fsPath;
      session.workspacePath = target;
      await ctx.reply(`✅ Workspace switched to: \`${target}\``, { parse_mode: "Markdown" });
      return;
    }

    // Try to match by path substring
    const match = folders.find((f) => f.uri.fsPath.toLowerCase().includes(args));
    if (match) {
      session.workspacePath = match.uri.fsPath;
      await ctx.reply(`✅ Workspace switched to: \`${match.uri.fsPath}\``, { parse_mode: "Markdown" });
      return;
    }

    await ctx.reply(
      `Unknown workspace '${escapeTg(args)}'.\n`
      + `Use \`/workspace list\` to see available folders, `
      + `or \`/workspace <number>\` to switch.`,
      { parse_mode: "Markdown" },
    );
  });

  // ── /session ────────────────────────────────────────────────

  bot.command("session", async (ctx) => {
    const args = ctx.match?.trim().split(/\s+/) || [];
    const sub = args[0]?.toLowerCase() || "list";

    // Create a session store using the storage directory
    const store = new SessionStore(storageUri);

    if (sub === "list") {
      const sessions_ = await store.list();
      if (sessions_.length === 0) {
        await ctx.reply("📭 No saved chat sessions found.");
        return;
      }
      const lines = sessions_.slice(0, 20).map((s) => {
        const date = new Date(s.updatedAt).toLocaleString();
        return `• \`${s.id}\` — ${truncate(s.title, 40)} (${date})`;
      });
      const more = sessions_.length > 20 ? `\n… and ${sessions_.length - 20} more` : "";
      await ctx.reply(`*Saved sessions (${sessions_.length}):*\n${lines.join("\n")}${more}`, { parse_mode: "Markdown" });
      return;
    }

    if (sub === "load") {
      const id = args[1];
      if (!id) {
        await ctx.reply("Usage: `/session load <id>` — get the id from `/session list`", { parse_mode: "Markdown" });
        return;
      }
      const stored = await store.load(id);
      if (!stored) {
        await ctx.reply(`Session '${escapeTg(id)}' not found.`);
        return;
      }
      const session_ = sessions.getOrCreate(ctx.chat!.id);
      session_.agentSession.setHistory(stored.history);
      session_.streamingMessageId = null;
      session_.streamingText = "";

      // Summarize the loaded session
      const userCount = stored.transcript.filter((t) => t.kind === "user").length;
      const assistantCount = stored.transcript.filter((t) => t.kind === "assistant").length;
      await ctx.reply(
        `✅ Loaded session *${escapeTg(truncate(stored.title, 50))}*\n`
        + `• ${userCount} user messages · ${assistantCount} assistant responses\n`
        + `• Last updated: ${new Date(stored.updatedAt).toLocaleString()}\n\n`
        + `Continue chatting normally — the conversation history is restored.`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    if (sub === "delete" || sub === "rm") {
      const id = args[1];
      if (!id) {
        await ctx.reply("Usage: `/session delete <id>`", { parse_mode: "Markdown" });
        return;
      }
      await store.delete(id);
      await ctx.reply(`🗑️ Session \`${escapeTg(id)}\` deleted.`, { parse_mode: "Markdown" });
      return;
    }

    if (sub === "info") {
      const id = args[1];
      if (!id) {
        await ctx.reply("Usage: `/session info <id>`", { parse_mode: "Markdown" });
        return;
      }
      const stored = await store.load(id);
      if (!stored) {
        await ctx.reply(`Session '${escapeTg(id)}' not found.`);
        return;
      }
      const userCount = stored.transcript.filter((t) => t.kind === "user").length;
      const assistantCount = stored.transcript.filter((t) => t.kind === "assistant").length;
      const toolCount = stored.transcript.filter((t) => t.kind === "tool").length;
      await ctx.reply(
        `📋 *Session: ${escapeTg(truncate(stored.title, 50))}*\n`
        + `• ID: \`${stored.id}\`\n`
        + `• Messages: ${userCount} user, ${assistantCount} assistant, ${toolCount} tools\n`
        + `• Last updated: ${new Date(stored.updatedAt).toLocaleString()}\n`
        + `• History turns: ${stored.history.length}`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    await ctx.reply(
      "Usage:\n"
      + "• `/session list` — List saved sessions\n"
      + "• `/session load <id>` — Load a session\n"
      + "• `/session info <id>` — Show session details\n"
      + "• `/session delete <id>` — Delete a session",
      { parse_mode: "Markdown" },
    );
  });

  // ── /new ────────────────────────────────────────────────────

  bot.command("new", async (ctx) => {
    sessions.reset(ctx.chat!.id);
    await ctx.reply("🔄 Conversation reset. Starting fresh.");
  });

  // ── /cancel ─────────────────────────────────────────────────

  bot.command("cancel", async (ctx) => {
    const session = sessions.get(ctx.chat!.id);
    if (session?.abortController) {
      session.abortController.abort();
      session.state = "idle";
      await ctx.reply("⏹️ Request cancelled.");
    } else {
      await ctx.reply("No active request to cancel.");
    }
  });

  // ── /status ─────────────────────────────────────────────────

  bot.command("status", async (ctx) => {
    const session = sessions.get(ctx.chat!.id);
    const root = session?.workspacePath || getWorkspacePath()
      || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const agentId = session?.agentId ?? "coder";
    const queued = session?.queue?.length ?? 0;
    const folders = (vscode.workspace.workspaceFolders ?? []).length;
    const lines = [
      `*Status:*`,
      `• Agent: \`${agentId}\``,
      `• Workspace: \`${root || "None"}\``,
      `• VS Code folders open: ${folders}`,
      `• State: ${session?.state === "running" ? "🟡 running" : "🟢 idle"}`,
      `• Queued: ${queued}`,
      `• Active chats: ${sessions.chatCount()}`,
    ];
    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });

  // ── File & photo attachments ────────────────────────────────

  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    const caption = ctx.message.caption || `Process this file: ${doc.file_name || "unknown"}`;
    const fileId = doc.file_id;
    const fileName = doc.file_name || "unknown_file";

    await ctx.reply(`📎 Downloading *${escapeTg(fileName)}*…`, { parse_mode: "Markdown" });

    const result = await downloadTelegramFile(bot, fileId);
    if (!result) {
      await ctx.reply("❌ Failed to download file.");
      return;
    }

    const textMimePrefixes = ["text/", "application/json", "application/xml", "application/javascript",
      "application/x-yaml", "application/typescript"];
    const isText = textMimePrefixes.some((p) => result.mimeType.startsWith(p));
    if (!isText) {
      await ctx.reply(`⚠️ Cannot process \`${escapeTg(fileName)}\` — binary file type (${result.mimeType}) is not supported.`, { parse_mode: "Markdown" });
      return;
    }

    const content = result.buffer.toString("utf8");
    const attachment: Attachment = {
      path: fileName,
      content: content.length > 40000
        ? content.slice(0, 40000) + "\n[...truncated]"
        : content,
      mimeType: result.mimeType,
    };

    runInBackground("Telegram document turn", () =>
      runAgentTurn(
        bot, ctx.chat!.id, caption,
        sessions, secrets, [attachment], getWorkspacePath(), storageUri,
      )
    );
  });

  bot.on("message:photo", async (ctx) => {
    const photos = ctx.message.photo;
    if (!photos || photos.length === 0) return;
    const caption = ctx.message.caption || "Describe this image.";

    // Use the largest available photo
    const largest = photos[photos.length - 1];
    await ctx.reply("🖼️ Processing image…");

    const result = await downloadTelegramFile(bot, largest.file_id);
    if (!result) {
      await ctx.reply("❌ Failed to download image.");
      return;
    }

    const mimeType = result.mimeType.startsWith("image/") ? result.mimeType : "image/jpeg";
    const base64 = result.buffer.toString("base64");
    const ext = mimeType.split("/")[1] || "jpg";
    const attachment: Attachment = {
      path: `image.${ext}`,
      content: `[Image: ${mimeType}]`,
      imageUrl: `data:${mimeType};base64,${base64}`,
      mimeType,
    };

    runInBackground("Telegram photo turn", () =>
      runAgentTurn(
        bot, ctx.chat!.id, caption,
        sessions, secrets, [attachment], getWorkspacePath(), storageUri,
      )
    );
  });

  // ── Plain text messages ─────────────────────────────────────

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    runInBackground("Telegram text turn", () =>
      runAgentTurn(bot, ctx.chat!.id, ctx.message.text, sessions, secrets, [], getWorkspacePath(), storageUri)
    );
  });

  // ── Callback queries (inline keyboard confirmations) ────────

  bot.callbackQuery(/^confirm:/, async (ctx) => {
    const data = ctx.callbackQuery.data;
    const parsed = parseConfirmCallbackData(data);
    console.log(`[TelegramBot] Confirmation callback received: chatId=${ctx.chat?.id}, data=${data}`);
    if (!parsed) {
      console.warn("[TelegramBot] Invalid confirmation callback data", data);
      await ctx.answerCallbackQuery("Invalid confirmation data.");
      return;
    }
    if (ctx.chat?.id !== parsed.chatId) {
      console.warn("[TelegramBot] Confirmation callback chat mismatch", { ctxChatId: ctx.chat?.id, expectedChatId: parsed.chatId });
      await ctx.answerCallbackQuery("This confirmation is from a different chat.");
      return;
    }
    const resolved = sessions.resolveConfirm(parsed.key, parsed.value);
    if (resolved) {
      console.log(`[TelegramBot] Confirmation resolved: key=${parsed.key}, value=${parsed.value}`);
      await ctx.answerCallbackQuery(parsed.value ? "Approved" : "Denied");
    } else {
      console.warn(`[TelegramBot] Confirmation key not found or expired: key=${parsed.key}`);
      await bot.api.sendMessage(parsed.chatId, "Confirmation was received, but the pending request was not found. Please send the command again.");
      await ctx.answerCallbackQuery("This confirmation has expired.");
    }
  });
}
