import type { LanguageModel, ModelMessage } from "ai";
import { exec } from "child_process";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";
import { addUsage, AgentCallbacks, AgentSession } from "./agent/agent";
import { AgentManager, AgentDefinition } from "./agent/agents";
import {
  configuredOpenTarget,
  configuredResolveRemoteLocalhost,
  isOpenTarget,
  openUrl,
} from "./browser/openUrl";
import { RepoIndex } from "./agent/embeddings";
import { McpManager } from "./agent/mcp";
import { MemoryStore } from "./agent/memory";
import { composeSystemPrompt } from "./agent/prompt";
import {
  buildRequestProviderOptions,
  buildSystemMessage,
  maxOutputTokensFor,
} from "./agent/providerTuning";
import {
  analyzeAttachments,
  FileAnalysisSettings,
  isAttachmentAnalyzable,
} from "./agent/fileAnalysis";
import { loadProjectRules, SkillManager } from "./agent/skills";
import { buildTools, TOOL_CATALOG, ToolContext } from "./agent/tools";
import {
  CAPABILITIES,
  fetchModels,
  getActiveModel,
  getActiveModelId,
  getActiveProviderId,
  getEmbeddingModel,
  getModelFor,
  getModelForConnection,
  hasCredential,
  isProviderId,
  PROVIDERS,
  PROVIDER_IDS,
  ProviderId,
  secretKeyFor,
} from "./providers";
import { TelegramBotManager } from "./telegram/bot";
import { resolveStorageDir } from "./agent/dataPath";
import { SessionStore, titleFrom } from "./sessions";
import {
  AgentDTO,
  Attachment,
  FileAnalysisUpdate,
  HostToWebview,
  PermissionLevel,
  ProviderConnectionSettings,
  ReasoningEffort,
  SkillDTO,
  TelegramActivityItem,
  ToolCatalogItem,
  TranscriptItem,
  UsageStats,
  WebviewToHost,
  WorkingSetFile,
} from "./shared/protocol";
import { eventBus, TelegramActivityEvent, TelegramSessionEvent } from "./shared/eventBus";

const ZERO_USAGE: UsageStats = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
};

const execAsync = promisify(exec);

const REVIEWER_PROMPT = `You are a meticulous engineering reviewer analyzing past AI coding chat sessions.
Produce a clear, well-structured markdown report with these sections:
## Summary — what the session(s) tried to accomplish and the outcome.
## Problems & friction — concrete issues, dead-ends, repeated mistakes, or inefficiencies (including token/cache waste).
## Quality assessment — rate clarity, correctness, efficiency, and tool usage (e.g. Good/Fair/Poor) with one-line justification each.
## Suggestions — specific, actionable improvements.
## Agent/skill updates — propose improvements to agents or reusable skills. For the most valuable, durable learnings, actually persist them using the create_skill tool, and record key project facts/preferences with the remember tool.
Be concise and specific. Do not modify source files.`;

interface WorkspaceServices {
  root: string;
  agents: AgentManager;
  skills: SkillManager;
  memory: MemoryStore;
  index: RepoIndex;
  mcp: McpManager;
  mcpConnected: boolean;
}

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = "aiAgentChat.chatView";

  private readonly webviews = new Set<vscode.Webview>();
  private session = new AgentSession();
  private abortController?: AbortController;
  private services?: WorkspaceServices;
  private readonly sessionStore: SessionStore;

  private currentSessionId: string;
  private transcript: TranscriptItem[] = [];
  private openAssistant: { kind: "assistant"; text: string; model?: string } | null = null;
  private currentTurnLabel = "";
  private toolIndexById = new Map<string, number>();
  private agentId: string;
  private reasoning: ReasoningEffort;
  private permission: PermissionLevel;
  private sessionUsage: UsageStats = { ...ZERO_USAGE };
  private turnUsage: UsageStats = { ...ZERO_USAGE };
  private turnSteps: { tools: string[]; usage: UsageStats }[] = [];
  private readonly modelCache = new Map<ProviderId, string[]>();
  private workingSet: WorkingSetFile[] = [];

  private telegramBot?: TelegramBotManager;
  private readonly disposeEventBus: () => void;

  constructor(private readonly context: vscode.ExtensionContext, telegramBot?: TelegramBotManager) {
    this.currentSessionId = this.newId();
    this.agentId = context.workspaceState.get<string>("aiAgentChat.agentId", "coder");
    this.reasoning = context.workspaceState.get<ReasoningEffort>("aiAgentChat.reasoning", "off");
    this.permission = context.workspaceState.get<PermissionLevel>("aiAgentChat.permission", "ask");
    this.sessionStore = new SessionStore(resolveStorageDir(context));
    this.telegramBot = telegramBot;

    // Listen to Telegram activity events and forward to webview
    this.disposeEventBus = eventBus.on("telegram:activity", (event) => {
      const activityItem: TelegramActivityItem = {
        id: `${event.chatId}-${event.timestamp}`,
        chatId: event.chatId,
        type: event.type,
        timestamp: event.timestamp,
        summary: this.formatTelegramActivitySummary(event),
        details: event.data,
      };
      this.post({ type: "telegramActivity", item: activityItem });
    });

    // Listen to Telegram session events and refresh sessions list
    const disposeSessionListener = eventBus.on("telegram:session", () => {
      this.sendSessions();
    });

    const prevDispose = this.disposeEventBus;
    this.disposeEventBus = () => {
      prevDispose();
      disposeSessionListener();
    };
  }

  dispose(): void {
    this.disposeEventBus();
  }

  private formatTelegramActivitySummary(event: TelegramActivityEvent): string {
    switch (event.type) {
      case "messageReceived":
        return `Chat ${event.chatId}: ${String(event.data.text).slice(0, 100)}`;
      case "turnStarted":
        return `Chat ${event.chatId}: Agent working...`;
      case "turnCompleted":
        return `Chat ${event.chatId}: Turn completed`;
      case "toolCalled":
        return `Chat ${event.chatId}: Using ${String(event.data.toolName)}`;
      case "toolResult":
        return `Chat ${event.chatId}: ${String(event.data.toolName)} completed`;
      case "error":
        return `Chat ${event.chatId}: Error - ${String(event.data.message).slice(0, 100)}`;
      case "fileChanged":
        return `Chat ${event.chatId}: File ${String(event.data.status)} ${String(event.data.filePath)}`;
      default:
        return `Chat ${event.chatId}: Activity`;
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
      ],
    };
    webview.html = this.getHtml(webview);
    this.attachWebview(webview);
    webviewView.onDidDispose(() => this.webviews.delete(webview));
  }

  /** Open the chat as a full-screen editor tab (like Copilot's "open in editor"). */
  openInEditor(): void {
    const panel = vscode.window.createWebviewPanel(
      ChatViewProvider.viewType,
      "AI Agent Chat",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, "dist"),
          vscode.Uri.joinPath(this.context.extensionUri, "media"),
        ],
      }
    );
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "robot.svg");
    panel.webview.html = this.getHtml(panel.webview);
    this.attachWebview(panel.webview);
    panel.onDidDispose(() => this.webviews.delete(panel.webview));
  }

  private attachWebview(webview: vscode.Webview): void {
    this.webviews.add(webview);
    webview.onDidReceiveMessage((m: WebviewToHost) => this.handleMessage(m));
  }

  newChat(): void {
    this.session.reset();
    this.transcript = [];
    this.openAssistant = null;
    this.toolIndexById.clear();
    this.currentSessionId = this.newId();
    this.sessionUsage = { ...ZERO_USAGE };
    this.workingSet = [];
    this.post({ type: "cleared" });
    this.post({ type: "workingSet", files: [] });
  }

  async buildIndexNow(): Promise<void> {
    await this.buildIndex();
  }

  async runE2EScenario(input: {
    text: string;
    attachments?: Attachment[];
    mockSteps?: unknown[];
  }): Promise<{
    posted: HostToWebview[];
    session: {
      transcript: TranscriptItem[];
      historyLength: number;
      sessions: { id: string; title: string; updatedAt: number }[];
    };
    workingSet: WorkingSetFile[];
  }> {
    if (!Array.isArray(input.mockSteps)) {
      throw new Error("E2E scenario command requires mockSteps.");
    }

    const posted: HostToWebview[] = [];
    const previousPermission = this.permission;
    const previousE2E = process.env.AI_AGENT_CHAT_E2E;
    const previousSteps = process.env.AI_AGENT_CHAT_E2E_MOCK_STEPS;
    const fakeWebview = {
      postMessage: (msg: HostToWebview) => {
        posted.push(msg);
        return Promise.resolve(true);
      },
    } as unknown as vscode.Webview;

    this.webviews.add(fakeWebview);
    try {
      this.permission = "auto";
      process.env.AI_AGENT_CHAT_E2E = "1";
      process.env.AI_AGENT_CHAT_E2E_MOCK_STEPS = JSON.stringify(input.mockSteps);
      await this.dispatchMessage({ type: "ready" });
      await this.dispatchMessage({
        type: "sendMessage",
        text: input.text,
        attachments: input.attachments ?? [],
      });
      return {
        posted,
        session: {
          transcript: [...this.transcript],
          historyLength: this.session.getHistory().length,
          sessions: await this.sessionStore.list(),
        },
        workingSet: [...this.workingSet],
      };
    } finally {
      this.permission = previousPermission;
      if (previousE2E === undefined) {
        delete process.env.AI_AGENT_CHAT_E2E;
      } else {
        process.env.AI_AGENT_CHAT_E2E = previousE2E;
      }
      if (previousSteps === undefined) {
        delete process.env.AI_AGENT_CHAT_E2E_MOCK_STEPS;
      } else {
        process.env.AI_AGENT_CHAT_E2E_MOCK_STEPS = previousSteps;
      }
      this.webviews.delete(fakeWebview);
    }
  }

  async quickChat(): Promise<void> {
    const text = await vscode.window.showInputBox({
      title: "AI Agent Quick Chat",
      prompt: "Ask a one-off question.",
      ignoreFocusOut: true,
    });
    if (text?.trim()) {
      await this.handleSend(text, []);
    }
  }

  async inlineChat(): Promise<void> {
    const text = await vscode.window.showInputBox({
      title: "AI Agent Inline Chat",
      prompt: "Ask about the active selection or file.",
      value: "/fix ",
      ignoreFocusOut: true,
    });
    if (!text?.trim()) {
      return;
    }
    const attachment = this.activeSelectionAttachment();
    await this.handleSend(text, attachment ? [attachment] : []);
  }

  // ---- Services -------------------------------------------------------
  private getServices(): WorkspaceServices | undefined {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      return undefined;
    }
    if (this.services?.root === root) {
      return this.services;
    }
    const base = resolveStorageDir(this.context);
    this.services = {
      root,
      agents: new AgentManager(root),
      skills: new SkillManager(root),
      memory: new MemoryStore(root),
      index: new RepoIndex(vscode.Uri.joinPath(base, "repo-index.json"), () =>
        getEmbeddingModel(this.context.secrets)
      ),
      mcp: new McpManager(root),
      mcpConnected: false,
    };
    return this.services;
  }

  // ---- Message routing ------------------------------------------------
  private async handleMessage(msg: WebviewToHost): Promise<void> {
    try {
      await this.dispatchMessage(msg);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: "error", message });
      vscode.window.showErrorMessage(`AI Agent Chat: ${message}`);
    }
  }

  private async dispatchMessage(msg: WebviewToHost): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this.sendInit();
        await this.sendSessions();
        if (this.transcript.length > 0) {
          this.post({
            type: "sessionLoaded",
            id: this.currentSessionId,
            items: this.transcript,
          });
        }
        break;
      case "sendMessage":
        await this.handleSend(msg.text, msg.attachments);
        break;
      case "cancel":
        this.abortController?.abort();
        break;
      case "newChat":
        this.newChat();
        break;
      case "selectProvider":
        await this.selectProvider(msg.provider as ProviderId);
        break;
      case "selectModel":
        await this.config().update("model", msg.model, vscode.ConfigurationTarget.Workspace);
        break;
      case "saveProviderSettings":
        await this.saveProviderSettings(msg.settings);
        break;
      case "saveFileAnalysisSettings":
        await this.saveFileAnalysisSettings(msg.settings);
        break;
      case "listModels":
        await this.sendModels(msg.provider as ProviderId, !!msg.refresh);
        break;
      case "selectAgent":
        this.agentId = msg.agentId;
        await this.context.workspaceState.update("aiAgentChat.agentId", msg.agentId);
        this.post({ type: "agentChanged", agentId: msg.agentId });
        break;
      case "selectReasoning":
        this.reasoning = msg.effort;
        await this.context.workspaceState.update("aiAgentChat.reasoning", msg.effort);
        this.post({ type: "reasoningChanged", effort: msg.effort });
        break;
      case "selectPermission":
        this.permission = msg.level;
        await this.context.workspaceState.update("aiAgentChat.permission", msg.level);
        this.post({ type: "permissionChanged", level: msg.level });
        break;
      case "setApiKey":
        await vscode.commands.executeCommand("aiAgentChat.setApiKey");
        await this.sendInit();
        break;
      case "buildIndex":
        await this.buildIndex();
        break;
      case "requestSessions":
        await this.sendSessions();
        break;
      case "loadSession":
        await this.loadSession(msg.id);
        break;
      case "deleteSession":
        await this.sessionStore.delete(msg.id);
        await this.sendSessions();
        break;
      case "pickFiles":
        await this.pickFiles();
        break;
      case "readDroppedPaths":
        await this.resolvePaths(msg.paths);
        break;
      case "searchFiles":
        await this.searchFiles(msg.query);
        break;
      case "openInEditor":
        this.openInEditor();
        break;
      case "openUrl":
        await openUrl(msg.url, {
          target: msg.target && isOpenTarget(msg.target) ? msg.target : configuredOpenTarget(),
          resolveRemoteLocalhost: configuredResolveRemoteLocalhost(),
        });
        break;
      case "openExternal":
        await openUrl(msg.url, {
          target: configuredOpenTarget(),
          resolveRemoteLocalhost: configuredResolveRemoteLocalhost(),
        });
        break;
      case "exportMarkdown":
        await this.exportMarkdown();
        break;
      case "insertAtCursor":
        await this.insertAtCursor(msg.code);
        break;
      case "insertIntoNewFile":
        await this.insertIntoNewFile(msg.code);
        break;
      case "addContext":
        await this.addContext(msg.kind);
        break;
      case "analyzeSessions":
        await this.runReview(msg.ids);
        break;
      case "listAgents":
        await this.sendAgents();
        break;
      case "saveAgent":
        await this.getServices()?.agents.save(dtoToAgent(msg.agent));
        await this.sendAgents();
        await this.sendInit();
        break;
      case "deleteAgent":
        await this.getServices()?.agents.delete(msg.id);
        await this.sendAgents();
        await this.sendInit();
        break;
      case "listSkills":
        await this.sendSkills();
        break;
      case "saveSkill":
        await this.getServices()?.skills.save(msg.skill);
        await this.sendSkills();
        break;
      case "deleteSkill":
        await this.getServices()?.skills.delete(msg.name);
        await this.sendSkills();
        break;
      case "listMcp":
        await this.connectMcp(false);
        await this.sendMcp();
        break;
      case "saveMcpServer":
        await this.getServices()?.mcp.saveServer(msg.server);
        await this.connectMcp(true);
        await this.sendMcp();
        break;
      case "deleteMcpServer":
        await this.getServices()?.mcp.deleteServer(msg.id);
        await this.sendMcp();
        break;
      case "reconnectMcp":
        await this.connectMcp(true);
        await this.sendMcp();
        break;
      // ---- Telegram messages -------------------------------------------
      case "getTelegramStatus":
        await this.sendTelegramStatus();
        break;
      case "startTelegram":
        try {
          await this.telegramBot?.start();
        } catch (e: unknown) {
          this.post({ type: "error", message: e instanceof Error ? e.message : String(e) });
        }
        await this.sendTelegramStatus();
        break;
      case "stopTelegram":
        try {
          await this.telegramBot?.stop();
        } catch (e: unknown) {
          this.post({ type: "error", message: e instanceof Error ? e.message : String(e) });
        }
        await this.sendTelegramStatus();
        break;
      case "setTelegramToken":
        try {
          await vscode.commands.executeCommand("aiAgentChat.setTelegramToken");
        } catch (e: unknown) {
          this.post({ type: "error", message: e instanceof Error ? e.message : String(e) });
        }
        await this.sendTelegramStatus();
        break;
      case "updateTelegramConfig":
        try {
          await this.saveTelegramConfig(msg.config);
          // Reload bot config so status reflects new values
          await this.telegramBot?.loadConfig();
        } catch (e: unknown) {
          this.post({ type: "error", message: e instanceof Error ? e.message : String(e) });
        }
        await this.sendTelegramStatus();
        break;
      // ---- Import / Export -----------------------------------------------
      case "exportAgent":
        await this.exportAgent(msg.agent);
        break;
      case "exportSkill":
        await this.exportSkill(msg.skill);
        break;
      case "importAgent":
        await this.importAgent();
        break;
      case "importSkill":
        await this.importSkill();
        break;
    }
  }

  private config() {
    return vscode.workspace.getConfiguration("aiAgentChat");
  }

  private async sendInit(): Promise<void> {
    const provider = getActiveProviderId();
    const model = getActiveModelId(provider);
    const services = this.getServices();
    let indexSize = 0;
    if (services) {
      await services.index.load();
      indexSize = services.index.size;
    }
    const agents = services ? await services.agents.list() : [];
    this.post({
      type: "init",
      providers: PROVIDER_IDS.map((id) => ({
        id,
        label: PROVIDERS[id].label,
        requiresApiKey: PROVIDERS[id].requiresApiKey,
        exampleModels: PROVIDERS[id].exampleModels,
        capabilities: CAPABILITIES[id],
        supportsBaseUrl: PROVIDERS[id].supportsBaseUrl,
      })),
      provider,
      model,
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        builtIn: !!a.builtIn,
      })),
      agentId: this.agentId,
      providerCredentials: Object.fromEntries(
        await Promise.all(
          PROVIDER_IDS.map(async (id) => [id, await hasCredential(id, this.context.secrets)])
        )
      ) as Record<string, boolean>,
      baseUrl: this.config().get<string>("baseUrl", ""),
      fileAnalysis: await this.getFileAnalysisSettings(),
      indexSize,
      reasoning: this.reasoning,
      permission: this.permission,
    });
  }

  private async selectProvider(provider: ProviderId): Promise<void> {
    await this.config().update("provider", provider, vscode.ConfigurationTarget.Workspace);
    await this.config().update("model", "", vscode.ConfigurationTarget.Workspace);
    const providerCredentials = Object.fromEntries(
      await Promise.all(
        PROVIDER_IDS.map(async (id) => [id, await hasCredential(id, this.context.secrets)])
      )
    ) as Record<string, boolean>;
    this.post({
      type: "providerChanged",
      provider,
      model: PROVIDERS[provider].defaultModel,
      hasApiKey: providerCredentials[provider],
      providerCredentials,
    });
  }

  private async saveProviderSettings(settings: ProviderConnectionSettings): Promise<void> {
    if (!isProviderId(settings.provider)) {
      throw new Error(`Unknown provider '${settings.provider}'.`);
    }
    const provider = settings.provider;
    await this.config().update("provider", provider, vscode.ConfigurationTarget.Workspace);
    await this.config().update("model", settings.model.trim(), vscode.ConfigurationTarget.Workspace);
    await this.config().update("baseUrl", settings.baseUrl.trim(), vscode.ConfigurationTarget.Workspace);
    if (settings.apiKey?.trim()) {
      await this.context.secrets.store(secretKeyFor(provider), settings.apiKey.trim());
    }
    await this.sendInit();
  }

  private async saveFileAnalysisSettings(settings: FileAnalysisUpdate): Promise<void> {
    if (!isProviderId(settings.provider)) {
      throw new Error(`Unknown file analysis provider '${settings.provider}'.`);
    }
    const config = this.config();
    await config.update(
      "fileAnalysis.enabled",
      settings.enabled,
      vscode.ConfigurationTarget.Workspace
    );
    await config.update(
      "fileAnalysis.provider",
      settings.provider,
      vscode.ConfigurationTarget.Workspace
    );
    await config.update("fileAnalysis.model", settings.model.trim(), vscode.ConfigurationTarget.Workspace);
    await config.update(
      "fileAnalysis.baseUrl",
      settings.baseUrl.trim(),
      vscode.ConfigurationTarget.Workspace
    );
    if (settings.apiKey?.trim()) {
      await this.context.secrets.store("aiAgentChat.fileAnalysis.apiKey", settings.apiKey.trim());
    }
    await this.sendInit();
  }

  private async sendModels(provider: ProviderId, refresh: boolean): Promise<void> {
    let models = refresh ? undefined : this.modelCache.get(provider);
    if (!models) {
      try {
        models = await fetchModels(provider, this.context.secrets);
      } catch {
        models = [];
      }
      if (models.length > 0) {
        this.modelCache.set(provider, models);
      }
    }
    this.post({ type: "models", provider, models, fetched: models.length > 0 });
  }

  private async getFileAnalysisSettings(): Promise<FileAnalysisSettings> {
    const configured = this.config().get<string>("fileAnalysis.provider", "openai");
    const provider = isProviderId(configured) ? configured : "openai";
    return {
      enabled: this.config().get<boolean>("fileAnalysis.enabled", true),
      provider,
      model:
        this.config().get<string>("fileAnalysis.model", "") ||
        PROVIDERS[provider].defaultModel,
      baseUrl: this.config().get<string>("fileAnalysis.baseUrl", ""),
      hasApiKey: await this.hasFileAnalysisCredential(provider),
    };
  }

  private async hasFileAnalysisCredential(provider: ProviderId): Promise<boolean> {
    if (!PROVIDERS[provider].requiresApiKey) {
      return true;
    }
    return !!(
      (await this.context.secrets.get("aiAgentChat.fileAnalysis.apiKey")) ||
      (await this.context.secrets.get(secretKeyFor(provider)))
    );
  }

  private async prepareAttachmentAnalysis(attachments: Attachment[]): Promise<Attachment[]> {
    if (!attachments.some(isAttachmentAnalyzable)) {
      return attachments;
    }
    const settings = await this.getFileAnalysisSettings();
    if (!settings.enabled) {
      return attachments;
    }
    try {
      const provider = settings.provider as ProviderId;
      const apiKey =
        (await this.context.secrets.get("aiAgentChat.fileAnalysis.apiKey")) ||
        (await this.context.secrets.get(secretKeyFor(provider)));
      const model = await getModelForConnection(provider, settings.model, this.context.secrets, {
        apiKey,
        baseURL: settings.baseUrl.trim() || undefined,
      });
      const signal = this.abortController?.signal ?? new AbortController().signal;
      return await analyzeAttachments(
        attachments,
        { model, providerId: provider, modelId: settings.model },
        signal,
        (text) => this.post({ type: "note", text })
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({
        type: "note",
        text: `File analysis failed; sending original attachment context. ${message}`,
      });
      return attachments;
    }
  }

  // ---- Chat turn ------------------------------------------------------
  private async handleSend(text: string, attachments: Attachment[]): Promise<void> {
    if (!text.trim() && attachments.length === 0) {
      return;
    }
    const services = this.getServices();
    if (!services) {
      this.post({ type: "error", message: "Open a folder before using the agent." });
      return;
    }

    const slash = this.expandSlash(text);
    if (slash) {
      text = slash.prompt;
      if (slash.includeSelection) {
        const sel = this.activeSelectionAttachment();
        if (sel) {
          attachments = [...attachments, sel];
        }
      }
    }
    text = this.expandParticipant(text);

    try {
      const agent =
        (await services.agents.get(this.agentId)) ?? (await services.agents.list())[0];
      const prep = await this.prepareRun(services, agent);
      this.currentTurnLabel = `${agent.name} · ${prep.providerId}/${prep.modelId}`;
      this.post({ type: "turnMeta", label: this.currentTurnLabel });

      await this.connectMcp(false);
      const toolCtx: ToolContext = {
        ...this.baseToolCtx(services),
        allowedSubAgents: agent.subAgents ?? [],
        delegate: (agentId, task) => this.runSubAgent(agentId, task),
      };
      const tools = { ...buildTools(toolCtx, agent.tools), ...services.mcp.getTools() };

      this.transcript.push({ kind: "user", text, attachments: attachments.map((a) => a.path) });
      this.openAssistant = null;
      this.turnUsage = { ...ZERO_USAGE };
      this.turnSteps = [];

      const maxSteps = this.config().get<number>("maxAgentSteps", 25);
      this.abortController = new AbortController();
      this.post({ type: "busy", value: true });

      attachments = await this.prepareAttachmentAnalysis(attachments);
      const userText = this.composeUserText(text, attachments);

      // If file analysis is disabled or unavailable, still allow direct image input.
      const imageAttachments = attachments
        .filter((a) => a.imageUrl)
        .map((a) => ({
          imageUrl: a.imageUrl!,
          mimeType: a.mimeType,
        }));

      await this.session.run({
        model: prep.model,
        systemMessage: prep.systemMessage,
        tools,
        userText,
        images: imageAttachments.length > 0 ? imageAttachments : undefined,
        maxSteps,
        maxOutputTokens: prep.maxOutputTokens,
        providerOptions: prep.providerOptions,
        signal: this.abortController.signal,
        callbacks: this.streamCallbacks(),
        timeoutMs: this.config().get<number>("modelCallTimeoutMs", 600_000),
        maxConsecutiveIdentical: this.config().get<number>("maxConsecutiveIdenticalToolCalls", 3),
        maxPatternBuffer: this.config().get<number>("maxPatternBufferSize", 20),
        maxHistoryPerTool: this.config().get<number>("maxHistoryPerTool", 20),
        burnRateWindow: this.config().get<number>("toolBurnRateWindow", 5),
        burnRateThreshold: this.config().get<number>("toolBurnRateThreshold", 3.0),
        frequencyWindowMs: this.config().get<number>("toolFrequencyWindowMs", 60_000),
        maxCallsPerWindow: this.config().get<number>("maxToolCallsPerWindow", 15),
        maxConsecutiveSimilarReasoning: this.config().get<number>("maxConsecutiveSimilarReasoning", 4),
        stepTimeoutMs: this.config().get<number>("stepTimeoutMs", 120_000),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.transcript.push({ kind: "error", text: message });
      this.post({ type: "error", message });
    } finally {
      this.post({ type: "busy", value: false });
      await this.persistSession(text);
    }
  }

  /** The streaming callbacks shared by chat turns and reviews. */
  private streamCallbacks(): AgentCallbacks {
    return {
      onTextDelta: (t) => {
        this.appendAssistant(t);
        this.post({ type: "assistantDelta", text: t });
      },
      onReasoningDelta: (t) => this.post({ type: "reasoningDelta", text: t }),
      onToolCall: (id, name, args) => {
        this.openAssistant = null;
        this.toolIndexById.set(id, this.transcript.length);
        this.transcript.push({ kind: "tool", id, name, args });
        this.post({ type: "toolCall", id, name, args });
      },
      onToolResult: (id, name, result) => {
        const idx = this.toolIndexById.get(id);
        const str = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        if (idx !== undefined) {
          const item = this.transcript[idx];
          if (item.kind === "tool") {
            item.result = str;
          }
        }
        this.post({ type: "toolResult", id, name, result: str });
      },
      onStepUsage: (toolNames, usage) => {
        this.turnSteps.push({ tools: toolNames, usage });
        this.turnUsage = addUsage(this.turnUsage, usage);
        this.post({
          type: "usage",
          turn: this.turnUsage,
          session: addUsage(this.sessionUsage, this.turnUsage),
          steps: this.turnSteps,
        });
      },
      onFinalUsage: (total) => {
        this.sessionUsage = addUsage(this.sessionUsage, total);
        this.post({
          type: "usage",
          turn: total,
          session: this.sessionUsage,
          steps: this.turnSteps,
        });
      },
      onError: (message) => {
        this.openAssistant = null;
        this.transcript.push({ kind: "error", text: message });
        this.post({ type: "error", message });
      },
      onDone: () => this.post({ type: "done" }),
    };
  }

  private composeUserText(text: string, attachments: Attachment[]): string {
    if (attachments.length === 0) {
      return text;
    }
    const blocks = attachments
      .map((a) => `File: ${a.path}\n\`\`\`\n${a.content}\n\`\`\``)
      .join("\n\n");
    return `${text}\n\nAttached context:\n${blocks}`;
  }

  private async collectAgentSkills(
    services: WorkspaceServices,
    names?: string[]
  ): Promise<string> {
    if (!names || names.length === 0) {
      return "";
    }
    const parts: string[] = [];
    for (const name of names) {
      const skill = await services.skills.get(name);
      if (skill) {
        parts.push(`<skill name="${skill.name}">\n${skill.body}\n</skill>`);
      }
    }
    return parts.join("\n\n");
  }

  private async prepareRun(
    services: WorkspaceServices,
    agent: AgentDefinition
  ): Promise<{
    model: LanguageModel;
    providerId: ProviderId;
    modelId: string;
    systemMessage: ModelMessage;
    providerOptions?: Record<string, Record<string, unknown>>;
    maxOutputTokens?: number;
  }> {
    const providerId = (agent.provider as ProviderId) ?? getActiveProviderId();
    const modelId =
      agent.model?.trim() ||
      (agent.provider ? PROVIDERS[providerId].defaultModel : getActiveModelId(providerId));
    const model = agent.provider
      ? await getModelFor(providerId, modelId, this.context.secrets)
      : (await getActiveModel(this.context.secrets)).model;

    const [projectRules, memory, alwaysSkills] = await Promise.all([
      loadProjectRules(services.root),
      services.memory.read(),
      services.skills.alwaysApplyText(),
    ]);
    const extraSkills = await this.collectAgentSkills(services, agent.skills);
    const systemText = composeSystemPrompt({
      agent,
      projectRules,
      memory,
      skills: [alwaysSkills, extraSkills].filter(Boolean).join("\n\n"),
    });
    return {
      model,
      providerId,
      modelId,
      systemMessage: buildSystemMessage(systemText, providerId),
      providerOptions: buildRequestProviderOptions(providerId, modelId, this.reasoning),
      maxOutputTokens: maxOutputTokensFor(providerId, modelId, this.reasoning),
    };
  }

  private baseToolCtx(services: WorkspaceServices): ToolContext {
    return {
      workspaceRoot: services.root,
      permission: this.permission,
      allowExternalFiles: this.config().get<boolean>("allowExternalFiles", false),
      confirm: (title, detail) => this.confirm(title, detail),
      previewEdit: (filePath, original, updated) =>
        this.previewEdit(filePath, original, updated),
      openUrl: (url, options) =>
        openUrl(url, {
          target: options?.target ?? configuredOpenTarget(),
          resolveRemoteLocalhost: configuredResolveRemoteLocalhost(),
        }),
      repoIndex: services.index,
      memory: services.memory,
      skills: services.skills,
      onNote: (m) => this.post({ type: "note", text: m }),
      trackFileChange: (path, status, fromPath) => this.trackFileChange(path, status, fromPath),
    };
  }

  /**
   * Run a sub-agent in an isolated conversation. Only its final text is
   * returned to the caller; intermediate steps stay out of the parent's
   * context (token isolation). Usage folds into session totals. Sub-agents
   * cannot delegate further (depth 1).
   */
  private async runSubAgent(agentId: string, task: string): Promise<string> {
    const services = this.getServices();
    if (!services) {
      return "No workspace open.";
    }
    const sub = await services.agents.get(agentId);
    if (!sub) {
      return `Unknown agent '${agentId}'.`;
    }
    const prep = await this.prepareRun(services, sub);
    const subCtx = this.baseToolCtx(services); // no delegate -> depth 1
    const tools = { ...buildTools(subCtx, sub.tools), ...services.mcp.getTools() };
    const maxSteps = this.config().get<number>("maxAgentSteps", 25);
    const session = new AgentSession();
    let finalText = "";

    this.post({ type: "note", text: `↳ Delegating to ${sub.name}…` });
    await session.run({
      model: prep.model,
      systemMessage: prep.systemMessage,
      tools,
      userText: task,
      maxSteps,
      maxOutputTokens: prep.maxOutputTokens,
      providerOptions: prep.providerOptions,
      signal: this.abortController?.signal ?? new AbortController().signal,
      timeoutMs: this.config().get<number>("modelCallTimeoutMs", 600_000),
      maxConsecutiveIdentical: this.config().get<number>("maxConsecutiveIdenticalToolCalls", 3),
      maxPatternBuffer: this.config().get<number>("maxPatternBufferSize", 20),
      maxHistoryPerTool: this.config().get<number>("maxHistoryPerTool", 20),
      burnRateWindow: this.config().get<number>("toolBurnRateWindow", 5),
      burnRateThreshold: this.config().get<number>("toolBurnRateThreshold", 3.0),
      frequencyWindowMs: this.config().get<number>("toolFrequencyWindowMs", 60_000),
      maxCallsPerWindow: this.config().get<number>("maxToolCallsPerWindow", 15),
      maxConsecutiveSimilarReasoning: this.config().get<number>("maxConsecutiveSimilarReasoning", 4),
      stepTimeoutMs: this.config().get<number>("stepTimeoutMs", 120_000),
      callbacks: {
        onTextDelta: (t) => {
          finalText += t;
        },
        onReasoningDelta: () => undefined,
        onToolCall: (_id, name) => this.post({ type: "note", text: `↳ ${sub.name}: ${name}` }),
        onToolResult: () => undefined,
        onStepUsage: (toolNames, usage) => {
          this.turnSteps.push({ tools: toolNames.map((n) => `↳${n}`), usage });
          this.turnUsage = addUsage(this.turnUsage, usage);
          this.post({
            type: "usage",
            turn: this.turnUsage,
            session: addUsage(this.sessionUsage, this.turnUsage),
            steps: this.turnSteps,
          });
        },
        onFinalUsage: (total) => {
          this.sessionUsage = addUsage(this.sessionUsage, total);
          this.post({
            type: "usage",
            turn: this.turnUsage,
            session: this.sessionUsage,
            steps: this.turnSteps,
          });
        },
        onError: (m) => {
          finalText += `\n[sub-agent error: ${m}]`;
        },
        onDone: () => undefined,
      },
    });

    return finalText.trim() || "(sub-agent produced no text output)";
  }

  private appendAssistant(text: string): void {
    if (this.openAssistant) {
      this.openAssistant.text += text;
    } else {
      this.openAssistant = { kind: "assistant", text, model: this.currentTurnLabel || undefined };
      this.transcript.push(this.openAssistant);
    }
  }

  private async confirm(title: string, detail: string): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(title, { modal: true, detail }, "Allow");
    return choice === "Allow";
  }

  private async previewEdit(
    filePath: string,
    original: string,
    updated: string
  ): Promise<boolean> {
    const base = resolveStorageDir(this.context);
    const dir = vscode.Uri.joinPath(base, "diff-previews", this.newId());
    await vscode.workspace.fs.createDirectory(dir);
    const safeName = filePath.replace(/[\\/:*?"<>|]+/g, "_") || "untitled";
    const originalUri = vscode.Uri.joinPath(dir, `${safeName}.original`);
    const proposedUri = vscode.Uri.joinPath(dir, `${safeName}.proposed`);
    await vscode.workspace.fs.writeFile(originalUri, Buffer.from(original, "utf8"));
    await vscode.workspace.fs.writeFile(proposedUri, Buffer.from(updated, "utf8"));
    await vscode.commands.executeCommand(
      "vscode.diff",
      originalUri,
      proposedUri,
      `AI edit preview: ${filePath}`
    );
    const choice = await vscode.window.showInformationMessage(
      `Accept AI edit for ${filePath}?`,
      { modal: true },
      "Accept",
      "Reject"
    );
    try {
      await vscode.workspace.fs.delete(dir, { recursive: true, useTrash: false });
    } catch {
      // Best-effort cleanup only; the files live in extension storage.
    }
    return choice === "Accept";
  }

  private trackFileChange(
    filePath: string,
    status: "created" | "modified" | "deleted" | "moved",
    fromPath?: string
  ): void {
    const existing = this.workingSet.find((f) => f.path === filePath);
    if (existing) {
      // Update existing entry
      if (status === "deleted") {
        this.workingSet = this.workingSet.filter((f) => f.path !== filePath);
      } else {
        existing.status = status;
        existing.timestamp = Date.now();
        if (fromPath) {
          existing.fromPath = fromPath;
        }
      }
    } else if (status !== "deleted") {
      // Add new entry
      this.workingSet.push({
        path: filePath,
        status,
        timestamp: Date.now(),
        fromPath,
      });
    }
    this.post({ type: "workingSet", files: [...this.workingSet] });
  }

  // ---- MCP ------------------------------------------------------------
  private async connectMcp(force: boolean): Promise<void> {
    const services = this.getServices();
    if (!services) {
      return;
    }
    if (services.mcpConnected && !force) {
      return;
    }
    await services.mcp.connectAll();
    services.mcpConnected = true;
  }

  private async sendMcp(): Promise<void> {
    const services = this.getServices();
    this.post({ type: "mcpStatus", servers: services?.mcp.getStatus() ?? [] });
  }

  // ---- Telegram -------------------------------------------------------
  private async sendTelegramStatus(): Promise<void> {
    const st = this.telegramBot?.status;
    this.post({
      type: "telegramStatus",
      status: {
        running: st?.running ?? false,
        chatCount: st?.chatCount ?? 0,
        uptime: st?.uptime ?? 0,
        allowedChatIds: st?.allowedChatIds ?? [],
        workspacePath: st?.workspacePath ?? "",
        startOnActivation: st?.startOnActivation ?? false,
        proxyUrl: st?.proxyUrl ?? "",
      },
    });
  }

  private async saveTelegramConfig(
    config: import("./shared/protocol").TelegramConfigUpdate
  ): Promise<void> {
    const tgConfig = vscode.workspace.getConfiguration("aiAgentChat.telegram");
    await tgConfig.update("allowedChatIds", config.allowedChatIds, vscode.ConfigurationTarget.Global);
    await tgConfig.update("workspacePath", config.workspacePath, vscode.ConfigurationTarget.Global);
    await tgConfig.update("startOnActivation", config.startOnActivation, vscode.ConfigurationTarget.Global);
    await tgConfig.update("proxyUrl", config.proxyUrl, vscode.ConfigurationTarget.Global);
  }

  // ---- Agents / Skills lists ------------------------------------------
  private async sendAgents(): Promise<void> {
    const services = this.getServices();
    if (!services) {
      this.post({ type: "agentsList", agents: [], toolCatalog: [] });
      return;
    }
    const agents = await services.agents.list();
    const mcpCatalog: ToolCatalogItem[] = services.mcp
      .getStatus()
      .flatMap((s) =>
        s.tools.map((n) => ({
          name: `${s.id}_${n}`,
          description: `MCP server '${s.id}'`,
          mutating: false,
          source: "mcp" as const,
        }))
      );
    const toolCatalog: ToolCatalogItem[] = [
      ...TOOL_CATALOG.map((t) => ({ ...t, source: "builtin" as const })),
      ...mcpCatalog,
    ];
    this.post({
      type: "agentsList",
      agents: agents.map(agentToDto),
      toolCatalog,
    });
  }

  private async sendSkills(): Promise<void> {
    const services = this.getServices();
    const skills = services ? await services.skills.list() : [];
    this.post({ type: "skillsList", skills });
  }

  // ---- Sessions -------------------------------------------------------
  private async persistSession(firstText: string): Promise<void> {
    if (this.transcript.length === 0) {
      return;
    }
    const firstUser = this.transcript.find((t) => t.kind === "user") as
      | { text: string }
      | undefined;
    await this.sessionStore.save({
      id: this.currentSessionId,
      title: titleFrom(firstUser?.text || firstText || "Chat"),
      updatedAt: Date.now(),
      transcript: this.transcript,
      history: this.session.getHistory(),
    });
    await this.sendSessions();
  }

  private async sendSessions(): Promise<void> {
    this.post({ type: "sessions", list: await this.sessionStore.list() });
  }

  private async loadSession(id: string): Promise<void> {
    const stored = await this.sessionStore.load(id);
    if (!stored) {
      return;
    }
    this.currentSessionId = stored.id;
    this.transcript = stored.transcript;
    this.session.setHistory(stored.history);
    this.openAssistant = null;
    this.toolIndexById.clear();
    this.sessionUsage = { ...ZERO_USAGE };
    this.post({ type: "sessionLoaded", id: stored.id, items: stored.transcript });
  }

  // ---- Index ----------------------------------------------------------
  private async buildIndex(): Promise<void> {
    const services = this.getServices();
    if (!services) {
      this.post({ type: "error", message: "Open a folder first." });
      return;
    }
    this.post({ type: "busy", value: true });
    try {
      const count = await services.index.build(services.root, (m) =>
        this.post({ type: "note", text: m })
      );
      this.post({ type: "note", text: `Semantic index built: ${count} chunks.` });
    } catch (err: unknown) {
      this.post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      this.post({ type: "busy", value: false });
    }
  }

  // ---- Attachments ----------------------------------------------------
  private async pickFiles(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: "Attach" });
    if (uris) {
      await this.resolvePaths(uris.map((u) => u.fsPath));
    }
  }

  private async resolvePaths(paths: string[]): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    const attachments: Attachment[] = [];
    for (const p of paths) {
      attachments.push(...(await this.resolvePathAttachments(p, root, 40)));
    }
    if (attachments.length > 0) {
      this.post({ type: "attachmentsResolved", attachments });
    }
  }

  private async resolvePathAttachments(
    fsPath: string,
    root: string,
    remaining: number
  ): Promise<Attachment[]> {
    if (remaining <= 0 || this.shouldSkipAttachedPath(fsPath)) {
      return [];
    }
    try {
      const uri = vscode.Uri.file(fsPath);
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.Directory) {
        const entries = await vscode.workspace.fs.readDirectory(uri);
        const out: Attachment[] = [];
        for (const [name] of entries) {
          if (out.length >= remaining) {
            break;
          }
          const child = path.join(fsPath, name);
          out.push(...(await this.resolvePathAttachments(child, root, remaining - out.length)));
        }
        return out;
      }
      return [await this.readAttachmentFile(fsPath, root)];
    } catch {
      return [];
    }
  }

  private async readAttachmentFile(fsPath: string, root: string): Promise<Attachment> {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath));
    const relPath = root ? path.relative(root, fsPath).replace(/\\/g, "/") : fsPath;
    const mimeType = mimeTypeForPath(fsPath);
    const base64 = Buffer.from(bytes).toString("base64");

    if (mimeType.startsWith("image/")) {
      return {
        path: relPath || fsPath,
        content: `[Image: ${path.basename(fsPath)}]`,
        imageUrl: `data:${mimeType};base64,${base64}`,
        mimeType,
      };
    }

    if (mimeType === "application/pdf" || isLikelyBinary(bytes)) {
      return {
        path: relPath || fsPath,
        content: `[File: ${path.basename(fsPath)}]`,
        dataBase64: base64,
        mimeType,
      };
    }

    let content = Buffer.from(bytes).toString("utf8");
    if (content.length > 40_000) {
      content = content.slice(0, 40_000) + "\n[...truncated]";
    }
    return { path: relPath || fsPath, content, mimeType };
  }

  private shouldSkipAttachedPath(fsPath: string): boolean {
    const parts = fsPath.split(/[\\/]/).map((p) => p.toLowerCase());
    return parts.some((p) => [".git", "node_modules", "dist", "out", "build"].includes(p));
  }

  /** Search workspace files and folders for the # mention picker. */
  private async searchFiles(query: string): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      this.post({ type: "fileResults", query, items: [] });
      return;
    }
    const q = query.toLowerCase();
    const files = await vscode.workspace.findFiles(
      "**/*",
      "{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**}",
      3000
    );

    const folderSet = new Map<string, string>();
    const fileRefs = files.map((f) => {
      const rel = path.relative(root, f.fsPath).replace(/\\/g, "/");
      const parts = rel.split("/");
      let acc = "";
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        if (!folderSet.has(acc)) {
          folderSet.set(acc, path.join(root, acc.replace(/\//g, path.sep)));
        }
      }
      return { path: rel, fsPath: f.fsPath, kind: "file" as const };
    });

    const folderRefs = [...folderSet].map(([rel, fsPath]) => ({
      path: `${rel}/`,
      fsPath,
      kind: "folder" as const,
    }));

    const score = (p: string): number => {
      const lower = p.toLowerCase();
      const base = lower.split("/").filter(Boolean).pop() ?? lower;
      if (!q) return 0;
      if (base.startsWith(q)) return 0;
      if (base.includes(q)) return 1;
      if (lower.includes(q)) return 2;
      return 99;
    };

    const items = [...folderRefs, ...fileRefs]
      .map((it) => ({ it, s: score(it.path) }))
      .filter((x) => x.s < 99)
      .sort((a, b) => a.s - b.s || a.it.path.length - b.it.path.length)
      .slice(0, 25)
      .map((x) => x.it);

    this.post({ type: "fileResults", query, items });
  }

  // ---- Code actions ---------------------------------------------------
  private expandSlash(
    text: string
  ): { prompt: string; includeSelection: boolean } | null {
    const m = /^\/(\w+)\s*([\s\S]*)$/.exec(text.trim());
    if (!m) {
      return null;
    }
    const rest = m[2].trim();
    const suffix = rest ? `: ${rest}` : ".";
    const map: Record<string, { prompt: string; includeSelection: boolean }> = {
      explain: { prompt: `Explain in detail how this code works${suffix}`, includeSelection: true },
      fix: {
        prompt: `Find and fix bugs or issues in this code, and explain the fix${suffix}`,
        includeSelection: true,
      },
      tests: { prompt: `Write thorough unit tests for this code${suffix}`, includeSelection: true },
      doc: {
        prompt: `Add clear documentation and comments to this code${suffix}`,
        includeSelection: true,
      },
    };
    return map[m[1].toLowerCase()] ?? null;
  }

  private expandParticipant(text: string): string {
    const m = /^@(\w+)\s*([\s\S]*)$/.exec(text.trim());
    if (!m) {
      return text;
    }
    const rest = m[2].trim() || "Help with the current task.";
    const map: Record<string, string> = {
      workspace:
        "Act as a workspace-aware coding agent. Use repository search, file reads, diagnostics, and tools as needed. Request: ",
      terminal:
        "Act as a terminal and build/debug assistant. Use command execution only when appropriate for the permission mode, and explain results. Request: ",
      vscode:
        "Act as a VS Code extension/workbench assistant. Prefer editor, diagnostics, and extension-context answers. Request: ",
    };
    const prefix = map[m[1].toLowerCase()];
    return prefix ? prefix + rest : text;
  }

  private activeSelectionAttachment(): Attachment | undefined {
    const ed = vscode.window.activeTextEditor;
    if (!ed) {
      return undefined;
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    const file = root ? path.relative(root, ed.document.uri.fsPath).replace(/\\/g, "/") : ed.document.uri.fsPath;
    const hasSel = !ed.selection.isEmpty;
    const content = hasSel ? ed.document.getText(ed.selection) : ed.document.getText();
    if (!content.trim()) {
      return undefined;
    }
    const clipped = content.length > 40_000 ? content.slice(0, 40_000) + "\n[...truncated]" : content;
    return { path: `${file}${hasSel ? " (selection)" : ""}`, content: clipped };
  }

  private async insertAtCursor(code: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage("Open a file and place the cursor to insert code.");
      return;
    }
    await editor.edit((b) => b.replace(editor.selection, code));
  }

  private async insertIntoNewFile(code: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({ content: code });
    await vscode.window.showTextDocument(doc);
  }

  private async exportMarkdown(): Promise<void> {
    if (this.transcript.length === 0) {
      vscode.window.showInformationMessage("Nothing to export.");
      return;
    }
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`ai-agent-chat-${new Date().toISOString().slice(0, 10)}.md`),
      filters: { Markdown: ["md"] },
      saveLabel: "Export chat",
    });
    if (!uri) {
      return;
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(this.transcriptToMarkdown(), "utf8"));
    vscode.window.showInformationMessage(`Exported chat to ${uri.fsPath}.`);
  }

  private transcriptToMarkdown(): string {
    const lines = ["# AI Agent Chat", ""];
    for (const item of this.transcript) {
      if (item.kind === "user") {
        lines.push("## User", "", item.text, "");
        if (item.attachments?.length) {
          lines.push(`Attachments: ${item.attachments.join(", ")}`, "");
        }
      } else if (item.kind === "assistant") {
        lines.push(`## Assistant${item.model ? ` (${item.model})` : ""}`, "", item.text, "");
      } else if (item.kind === "tool") {
        lines.push(
          `## Tool: ${item.name}`,
          "",
          "```json",
          JSON.stringify(item.args, null, 2),
          "```",
          ""
        );
        if (item.result) {
          lines.push("```", item.result.slice(0, 4000), "```", "");
        }
      } else {
        lines.push("## Error", "", item.text, "");
      }
    }
    return lines.join("\n");
  }

  // ---- Import / Export agents & skills ---------------------------------

  private async exportAgent(agent: AgentDTO): Promise<void> {
    const { builtIn, ...data } = agent;
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${agent.id || "agent"}.json`),
      filters: { "Agent definition": ["json"] },
      saveLabel: "Export agent",
    });
    if (!uri) return;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(data, null, 2), "utf8"));
    vscode.window.showInformationMessage(`Exported agent '${agent.name}' to ${uri.fsPath}.`);
  }

  private async exportSkill(skill: SkillDTO): Promise<void> {
    const frontmatter = [
      "---",
      `name: ${skill.name}`,
      `description: ${skill.description || ""}`,
      `alwaysApply: ${skill.alwaysApply}`,
      "---",
      "",
    ].join("\n");
    const content = frontmatter + skill.body;
    const slug = skill.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${slug || "skill"}.md`),
      filters: { "Skill definition": ["md"] },
      saveLabel: "Export skill",
    });
    if (!uri) return;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
    vscode.window.showInformationMessage(`Exported skill '${skill.name}' to ${uri.fsPath}.`);
  }

  private async importAgent(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { "Agent definition": ["json"] },
      openLabel: "Import agent",
    });
    if (!uris || uris.length === 0) return;
    try {
      const bytes = await vscode.workspace.fs.readFile(uris[0]);
      const raw = JSON.parse(Buffer.from(bytes).toString("utf8"));
      const agent: AgentDTO = {
        id: String(raw.id || path.basename(uris[0].fsPath, ".json")),
        name: String(raw.name || raw.id || "Imported Agent"),
        description: String(raw.description || ""),
        systemPrompt: String(raw.systemPrompt || ""),
        tools: Array.isArray(raw.tools) ? raw.tools.map(String) : "all",
        provider: raw.provider,
        model: raw.model,
        skills: Array.isArray(raw.skills) ? raw.skills.map(String) : undefined,
        subAgents: Array.isArray(raw.subAgents) ? raw.subAgents.map(String) : undefined,
      };
      this.post({ type: "importedAgent", agent });
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Failed to import agent: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async importSkill(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { "Skill definition": ["md"] },
      openLabel: "Import skill",
    });
    if (!uris || uris.length === 0) return;
    try {
      const bytes = await vscode.workspace.fs.readFile(uris[0]);
      const text = Buffer.from(bytes).toString("utf8");
      const skill = this.parseSkillFile(text, uris[0].fsPath);
      this.post({ type: "importedSkill", skill });
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Failed to import skill: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private parseSkillFile(text: string, filePath: string): SkillDTO {
    let name = "";
    let description = "";
    let alwaysApply = false;
    let body = text;
    const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n/);
    if (fmMatch) {
      const fm = fmMatch[1];
      body = text.slice(fmMatch[0].length);
      for (const line of fm.split("\n")) {
        const [key, ...rest] = line.split(":");
        if (key && rest.length > 0) {
          const val = rest.join(":").trim();
          if (key === "name") name = val;
          else if (key === "description") description = val;
          else if (key === "alwaysApply") alwaysApply = val === "true";
        }
      }
    }
    if (!name) {
      name = path.basename(filePath, path.extname(filePath));
    }
    return { name, description, alwaysApply, body: body.trim() };
  }

  // ---- Context chips --------------------------------------------------
  private async addContext(
    kind: "selection" | "editor" | "problems" | "changes"
  ): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    const rel = (p: string) => (root ? path.relative(root, p).replace(/\\/g, "/") : p);
    const clip = (s: string) => (s.length > 40_000 ? s.slice(0, 40_000) + "\n[...truncated]" : s);
    let attachment: Attachment | undefined;

    if (kind === "selection" || kind === "editor") {
      const ed = vscode.window.activeTextEditor;
      if (!ed) {
        vscode.window.showInformationMessage("No active editor.");
        return;
      }
      const file = rel(ed.document.uri.fsPath);
      const content = kind === "selection" ? ed.document.getText(ed.selection) : ed.document.getText();
      if (!content.trim()) {
        vscode.window.showInformationMessage("Nothing to add as context.");
        return;
      }
      attachment = { path: kind === "selection" ? `${file} (selection)` : file, content: clip(content) };
    } else if (kind === "problems") {
      const lines: string[] = [];
      for (const [uri, list] of vscode.languages.getDiagnostics()) {
        for (const d of list) {
          const sev = ["Error", "Warning", "Info", "Hint"][d.severity] ?? "Info";
          lines.push(`${rel(uri.fsPath)}:${d.range.start.line + 1} [${sev}] ${d.message}`);
        }
      }
      if (lines.length === 0) {
        vscode.window.showInformationMessage("No problems reported.");
        return;
      }
      attachment = { path: "problems", content: lines.slice(0, 200).join("\n") };
    } else if (kind === "changes") {
      if (!root) {
        return;
      }
      try {
        const { stdout } = await execAsync("git diff --stat && git diff", {
          cwd: root,
          maxBuffer: 10 * 1024 * 1024,
        });
        if (!stdout.trim()) {
          vscode.window.showInformationMessage("No git changes.");
          return;
        }
        attachment = { path: "git changes", content: clip(stdout) };
      } catch (err: unknown) {
        vscode.window.showInformationMessage(
          "Could not read git changes: " + (err instanceof Error ? err.message : String(err))
        );
        return;
      }
    }

    if (attachment) {
      this.post({ type: "attachmentsResolved", attachments: [attachment] });
    }
  }

  // ---- Review / analyze ----------------------------------------------
  private digestTranscript(title: string, items: TranscriptItem[]): string {
    const lines = items.map((it) => {
      switch (it.kind) {
        case "user":
          return `USER: ${it.text}`;
        case "assistant":
          return `ASSISTANT${it.model ? ` (${it.model})` : ""}: ${it.text.slice(0, 1500)}`;
        case "tool":
          return `TOOL ${it.name}(${JSON.stringify(it.args).slice(0, 200)}) -> ${(it.result ?? "").slice(0, 300)}`;
        case "error":
          return `ERROR: ${it.text}`;
      }
    });
    const body = lines.join("\n").slice(0, 12_000);
    return `### Session: ${title}\n${body}`;
  }

  private async runReview(ids: string[]): Promise<void> {
    const services = this.getServices();
    if (!services) {
      this.post({ type: "error", message: "Open a folder first." });
      return;
    }

    const digests: string[] = [];
    if (ids.length === 0) {
      if (this.transcript.length === 0) {
        this.post({ type: "error", message: "Nothing to analyze yet." });
        return;
      }
      digests.push(this.digestTranscript("current chat", this.transcript));
    } else {
      for (const id of ids) {
        const s = await this.sessionStore.load(id);
        if (s) {
          digests.push(this.digestTranscript(s.title, s.transcript));
        }
      }
    }
    if (digests.length === 0) {
      this.post({ type: "error", message: "No sessions found to analyze." });
      return;
    }

    const reviewer: AgentDefinition = {
      id: "reviewer",
      name: "Reviewer",
      description: "Analyzes chats and improves agents/skills.",
      systemPrompt: REVIEWER_PROMPT,
      tools: ["create_skill", "remember", "read_file", "search_text"],
      builtIn: true,
    };

    try {
      const prep = await this.prepareRun(services, reviewer);
      this.currentTurnLabel = `Reviewer · ${prep.providerId}/${prep.modelId}`;
      this.post({ type: "turnMeta", label: this.currentTurnLabel });

      await this.connectMcp(false);
      const tools = buildTools(this.baseToolCtx(services), reviewer.tools);
      const userText =
        `Analyze the following ${digests.length} chat session(s) and produce the review report. ` +
        `Persist the most valuable improvements with create_skill / remember.\n\n` +
        digests.join("\n\n---\n\n");

      this.transcript.push({
        kind: "user",
        text: ids.length ? `🔎 Analyze ${ids.length} session(s)` : "🔎 Analyze current chat",
      });
      this.openAssistant = null;
      this.turnUsage = { ...ZERO_USAGE };
      this.turnSteps = [];

      this.abortController = new AbortController();
      this.post({ type: "busy", value: true });
      await this.session.run({
        model: prep.model,
        systemMessage: prep.systemMessage,
        tools,
        userText,
        maxSteps: this.config().get<number>("maxAgentSteps", 25),
        maxOutputTokens: prep.maxOutputTokens,
        providerOptions: prep.providerOptions,
        signal: this.abortController.signal,
        callbacks: this.streamCallbacks(),
        timeoutMs: this.config().get<number>("modelCallTimeoutMs", 600_000),
        maxConsecutiveIdentical: this.config().get<number>("maxConsecutiveIdenticalToolCalls", 3),
        maxPatternBuffer: this.config().get<number>("maxPatternBufferSize", 20),
        maxHistoryPerTool: this.config().get<number>("maxHistoryPerTool", 20),
        burnRateWindow: this.config().get<number>("toolBurnRateWindow", 5),
        burnRateThreshold: this.config().get<number>("toolBurnRateThreshold", 3.0),
        frequencyWindowMs: this.config().get<number>("toolFrequencyWindowMs", 60_000),
        maxCallsPerWindow: this.config().get<number>("maxToolCallsPerWindow", 15),
        maxConsecutiveSimilarReasoning: this.config().get<number>("maxConsecutiveSimilarReasoning", 4),
        stepTimeoutMs: this.config().get<number>("stepTimeoutMs", 120_000),
      });
    } catch (err: unknown) {
      this.post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      this.post({ type: "busy", value: false });
      await this.persistSession("Review");
      await this.sendSkills();
    }
  }

  // ---- Plumbing -------------------------------------------------------
  private newId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private post(msg: HostToWebview): void {
    for (const webview of this.webviews) {
      try {
        webview.postMessage(msg);
      } catch {
        // Webview may have been disposed; silently ignore
      }
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.css")
    );
    const nonce = getNonce();
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} https: data:`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>AI Agent Chat</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function agentToDto(a: import("./agent/agents").AgentDefinition): AgentDTO {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    systemPrompt: a.systemPrompt,
    tools: a.tools,
    provider: a.provider,
    model: a.model,
    skills: a.skills,
    subAgents: a.subAgents,
    builtIn: !!a.builtIn,
  };
}

function dtoToAgent(d: AgentDTO): import("./agent/agents").AgentDefinition {
  return {
    id: d.id || d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name: d.name,
    description: d.description,
    systemPrompt: d.systemPrompt,
    tools: d.tools,
    provider: d.provider as ProviderId | undefined,
    model: d.model,
    skills: d.skills,
    subAgents: d.subAgents,
  };
}

function mimeTypeForPath(fsPath: string): string {
  const ext = path.extname(fsPath).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".json": "application/json",
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".ts": "text/typescript",
    ".tsx": "text/typescript",
    ".jsx": "text/javascript",
  };
  return map[ext] ?? "text/plain";
}

function isLikelyBinary(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, Math.min(bytes.length, 2048));
  return sample.some((b) => b === 0);
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
