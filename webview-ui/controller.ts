import { useEffect, useRef, useState } from "react";
import {
  AgentDTO,
  AgentInfo,
  Attachment,
  FileAnalysisSettings,
  FileAnalysisUpdate,
  FileRef,
  McpServerConfig,
  McpServerStatus,
  PermissionLevel,
  ProviderConnectionSettings,
  ProviderInfo,
  ReasoningEffort,
  SessionSummary,
  SkillDTO,
  StepUsage,
  TelegramActivityItem,
  TelegramConfigUpdate,
  TelegramStatus,
  ToolCatalogItem,
  TranscriptItem,
  UsageStats,
  WorkingSetFile,
} from "../src/shared/protocol";
import { onHostMessage, vscode } from "./vscodeApi";

export interface ToolUiItem {
  kind: "tool";
  id: string;
  name: string;
  args: unknown;
  result?: string;
  status: "running" | "done";
}

export type ChatItem =
  | { kind: "user"; text: string; attachments?: string[] }
  | { kind: "assistant"; text: string; reasoning: string; open: boolean; model?: string }
  | { kind: "error"; text: string }
  | ToolUiItem;

export interface ChatState {
  providers: ProviderInfo[];
  provider: string;
  model: string;
  agents: AgentInfo[];
  agentId: string;
  reasoning: ReasoningEffort;
  permission: PermissionLevel;
  hasApiKey: boolean;
  baseUrl: string;
  fileAnalysis: FileAnalysisSettings;
  indexSize: number;
  modelsByProvider: Record<string, string[]>;
  items: ChatItem[];
  busy: boolean;
  note: string;
  attachments: Attachment[];
  fileResults: FileRef[];
  sessions: SessionSummary[];
  usage?: { turn: UsageStats; session: UsageStats; steps: StepUsage[] };
  agentDtos: AgentDTO[];
  toolCatalog: ToolCatalogItem[];
  skills: SkillDTO[];
  mcpServers: McpServerStatus[];
  telegramStatus: TelegramStatus;
  telegramActivity: TelegramActivityItem[];
  workingSet: WorkingSetFile[];
}

const INITIAL: ChatState = {
  providers: [],
  provider: "openai",
  model: "",
  agents: [],
  agentId: "coder",
  reasoning: "off",
  permission: "ask",
  hasApiKey: true,
  baseUrl: "",
  fileAnalysis: {
    enabled: true,
    provider: "openai",
    model: "gpt-4o-mini",
    baseUrl: "",
    hasApiKey: false,
  },
  indexSize: 0,
  modelsByProvider: {},
  items: [],
  busy: false,
  note: "",
  attachments: [],
  fileResults: [],
  sessions: [],
  agentDtos: [],
  toolCatalog: [],
  skills: [],
  mcpServers: [],
  telegramStatus: {
    running: false,
    chatCount: 0,
    uptime: 0,
    allowedChatIds: [],
    workspacePath: "",
    startOnActivation: false,
    proxyUrl: "",
  },
  telegramActivity: [],
  workingSet: [],
};

export interface Actions {
  send(text: string): void;
  cancel(): void;
  newChat(): void;
  selectProvider(p: string): void;
  selectModel(m: string): void;
  saveProviderSettings(settings: ProviderConnectionSettings): void;
  saveFileAnalysisSettings(settings: FileAnalysisUpdate): void;
  listModels(provider: string, refresh?: boolean): void;
  selectAgent(id: string): void;
  selectReasoning(e: ReasoningEffort): void;
  selectPermission(l: PermissionLevel): void;
  setApiKey(): void;
  buildIndex(): void;
  requestSessions(): void;
  loadSession(id: string): void;
  deleteSession(id: string): void;
  pickFiles(): void;
  dropPaths(paths: string[]): void;
  addAttachments(attachments: Attachment[]): void;
  removeAttachment(path: string): void;
  searchFiles(query: string): void;
  openInEditor(): void;
  exportMarkdown(): void;
  addContext(kind: "selection" | "editor" | "problems" | "changes"): void;
  analyzeSessions(ids: string[]): void;
  listAgents(): void;
  saveAgent(a: AgentDTO): void;
  deleteAgent(id: string): void;
  listSkills(): void;
  saveSkill(s: SkillDTO): void;
  deleteSkill(name: string): void;
  listMcp(): void;
  saveMcpServer(s: McpServerConfig): void;
  deleteMcpServer(id: string): void;
  reconnectMcp(): void;
  getTelegramStatus(): void;
  startTelegram(): void;
  stopTelegram(): void;
  setTelegramToken(): void;
  updateTelegramConfig(config: TelegramConfigUpdate): void;
  clearTelegramActivity(): void;
  exportAgent(a: AgentDTO): void;
  exportSkill(s: SkillDTO): void;
  importAgent(): void;
  importSkill(): void;
}

export function useController(): { state: ChatState; actions: Actions } {
  const [state, setState] = useState<ChatState>(INITIAL);
  const turnModelRef = useRef<string>("");

  const patch = (p: Partial<ChatState>) => setState((s) => ({ ...s, ...p }));
  const setItems = (fn: (prev: ChatItem[]) => ChatItem[]) =>
    setState((s) => ({ ...s, items: fn(s.items) }));

  useEffect(() => {
    const dispose = onHostMessage((msg) => {
      switch (msg.type) {
        case "init":
          patch({
            providers: msg.providers,
            provider: msg.provider,
            model: msg.model,
            agents: msg.agents,
            agentId: msg.agentId,
            hasApiKey: msg.hasApiKey,
            baseUrl: msg.baseUrl,
            fileAnalysis: msg.fileAnalysis,
            indexSize: msg.indexSize,
            reasoning: msg.reasoning,
            permission: msg.permission,
          });
          break;
        case "providerChanged":
          patch({ provider: msg.provider, model: msg.model, hasApiKey: msg.hasApiKey });
          break;
        case "models":
          setState((s) => ({
            ...s,
            modelsByProvider: { ...s.modelsByProvider, [msg.provider]: msg.models },
          }));
          break;
        case "agentChanged":
          patch({ agentId: msg.agentId });
          break;
        case "reasoningChanged":
          patch({ reasoning: msg.effort });
          break;
        case "permissionChanged":
          patch({ permission: msg.level });
          break;
        case "turnMeta":
          turnModelRef.current = msg.label;
          break;
        case "assistantDelta":
          setItems((prev) => appendToAssistant(prev, "text", msg.text, turnModelRef.current));
          break;
        case "reasoningDelta":
          setItems((prev) => appendToAssistant(prev, "reasoning", msg.text, turnModelRef.current));
          break;
        case "toolCall":
          setItems((prev) => [
            ...closeAssistant(prev),
            { kind: "tool", id: msg.id, name: msg.name, args: msg.args, status: "running" },
          ]);
          break;
        case "toolResult":
          setItems((prev) =>
            prev.map((it) =>
              it.kind === "tool" && it.id === msg.id
                ? { ...it, result: msg.result, status: "done" }
                : it
            )
          );
          break;
        case "done":
          setItems((prev) => closeAssistant(prev));
          break;
        case "error":
          setItems((prev) => [...closeAssistant(prev), { kind: "error", text: msg.message }]);
          break;
        case "busy":
          patch({ busy: msg.value });
          if (!msg.value) {
            patch({ note: "" });
          }
          break;
        case "note":
          patch({ note: msg.text });
          break;
        case "cleared":
          patch({ items: [], attachments: [], usage: undefined });
          break;
        case "sessions":
          patch({ sessions: msg.list });
          break;
        case "sessionLoaded":
          patch({ items: msg.items.map(transcriptToChat) });
          break;
        case "attachmentsResolved":
          setState((s) => ({ ...s, attachments: mergeAttachments(s.attachments, msg.attachments) }));
          break;
        case "fileResults":
          patch({ fileResults: msg.items });
          break;
        case "usage":
          patch({ usage: { turn: msg.turn, session: msg.session, steps: msg.steps } });
          break;
        case "agentsList":
          patch({ agentDtos: msg.agents, toolCatalog: msg.toolCatalog });
          break;
        case "skillsList":
          patch({ skills: msg.skills });
          break;
        case "mcpStatus":
          patch({ mcpServers: msg.servers });
          break;
        case "workingSet":
          patch({ workingSet: msg.files });
          break;
        case "telegramStatus":
          patch({ telegramStatus: msg.status });
          break;
        case "telegramActivity":
          setState((s) => ({
            ...s,
            telegramActivity: [...s.telegramActivity.slice(-49), msg.item],
          }));
          break;
        case "importedAgent":
          setState((s) => ({
            ...s,
            agentDtos: [...s.agentDtos, msg.agent],
          }));
          break;
        case "importedSkill":
          setState((s) => ({
            ...s,
            skills: [...s.skills, msg.skill],
          }));
          break;
      }
    });
    vscode.postMessage({ type: "ready" });
    return dispose;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actions: Actions = {
    send(text) {
      if (text.trim() === "/clear") {
        vscode.postMessage({ type: "newChat" });
        return;
      }
      setState((s) => {
        if (!text.trim() && s.attachments.length === 0) {
          return s;
        }
        vscode.postMessage({ type: "sendMessage", text, attachments: s.attachments });
        return {
          ...s,
          items: [
            ...s.items,
            { kind: "user", text, attachments: s.attachments.map((a) => a.path) },
          ],
          attachments: [],
        };
      });
    },
    cancel: () => vscode.postMessage({ type: "cancel" }),
    newChat: () => vscode.postMessage({ type: "newChat" }),
    selectProvider: (p) => vscode.postMessage({ type: "selectProvider", provider: p }),
    selectModel: (m) => {
      patch({ model: m });
      vscode.postMessage({ type: "selectModel", model: m });
    },
    saveProviderSettings: (settings) =>
      vscode.postMessage({ type: "saveProviderSettings", settings }),
    saveFileAnalysisSettings: (settings) =>
      vscode.postMessage({ type: "saveFileAnalysisSettings", settings }),
    listModels: (provider, refresh) =>
      vscode.postMessage({ type: "listModels", provider, refresh }),
    selectAgent: (id) => vscode.postMessage({ type: "selectAgent", agentId: id }),
    selectReasoning: (e) => vscode.postMessage({ type: "selectReasoning", effort: e }),
    selectPermission: (l) => vscode.postMessage({ type: "selectPermission", level: l }),
    setApiKey: () => vscode.postMessage({ type: "setApiKey" }),
    buildIndex: () => vscode.postMessage({ type: "buildIndex" }),
    requestSessions: () => vscode.postMessage({ type: "requestSessions" }),
    loadSession: (id) => vscode.postMessage({ type: "loadSession", id }),
    deleteSession: (id) => vscode.postMessage({ type: "deleteSession", id }),
    pickFiles: () => vscode.postMessage({ type: "pickFiles" }),
    dropPaths: (paths) => vscode.postMessage({ type: "readDroppedPaths", paths }),
    addAttachments: (attachments) =>
      setState((s) => ({ ...s, attachments: mergeAttachments(s.attachments, attachments) })),
    removeAttachment: (p) =>
      setState((s) => ({ ...s, attachments: s.attachments.filter((a) => a.path !== p) })),
    searchFiles: (query) => vscode.postMessage({ type: "searchFiles", query }),
    openInEditor: () => vscode.postMessage({ type: "openInEditor" }),
    exportMarkdown: () => vscode.postMessage({ type: "exportMarkdown" }),
    addContext: (kind) => vscode.postMessage({ type: "addContext", kind }),
    analyzeSessions: (ids) => vscode.postMessage({ type: "analyzeSessions", ids }),
    listAgents: () => vscode.postMessage({ type: "listAgents" }),
    saveAgent: (a) => vscode.postMessage({ type: "saveAgent", agent: a }),
    deleteAgent: (id) => vscode.postMessage({ type: "deleteAgent", id }),
    listSkills: () => vscode.postMessage({ type: "listSkills" }),
    saveSkill: (s) => vscode.postMessage({ type: "saveSkill", skill: s }),
    deleteSkill: (name) => vscode.postMessage({ type: "deleteSkill", name }),
    listMcp: () => vscode.postMessage({ type: "listMcp" }),
    saveMcpServer: (s) => vscode.postMessage({ type: "saveMcpServer", server: s }),
    deleteMcpServer: (id) => vscode.postMessage({ type: "deleteMcpServer", id }),
    reconnectMcp: () => vscode.postMessage({ type: "reconnectMcp" }),
    getTelegramStatus: () => vscode.postMessage({ type: "getTelegramStatus" }),
    startTelegram: () => vscode.postMessage({ type: "startTelegram" }),
    stopTelegram: () => vscode.postMessage({ type: "stopTelegram" }),
    setTelegramToken: () => vscode.postMessage({ type: "setTelegramToken", token: "" }),
    updateTelegramConfig: (config) => vscode.postMessage({ type: "updateTelegramConfig", config }),
    clearTelegramActivity: () => patch({ telegramActivity: [] }),
    exportAgent: (a) => vscode.postMessage({ type: "exportAgent", agent: a }),
    exportSkill: (s) => vscode.postMessage({ type: "exportSkill", skill: s }),
    importAgent: () => vscode.postMessage({ type: "importAgent" }),
    importSkill: () => vscode.postMessage({ type: "importSkill" }),
  };

  return { state, actions };
}

function appendToAssistant(
  prev: ChatItem[],
  field: "text" | "reasoning",
  delta: string,
  model: string
): ChatItem[] {
  const last = prev[prev.length - 1];
  if (last && last.kind === "assistant" && last.open) {
    const copy = [...prev];
    copy[copy.length - 1] = { ...last, [field]: last[field] + delta };
    return copy;
  }
  const fresh: ChatItem = {
    kind: "assistant",
    text: "",
    reasoning: "",
    open: true,
    model: model || undefined,
    [field]: delta,
  };
  return [...prev, fresh];
}

function closeAssistant(prev: ChatItem[]): ChatItem[] {
  const last = prev[prev.length - 1];
  if (last && last.kind === "assistant" && last.open) {
    const copy = [...prev];
    copy[copy.length - 1] = { ...last, open: false };
    return copy;
  }
  return prev;
}

function transcriptToChat(t: TranscriptItem): ChatItem {
  switch (t.kind) {
    case "user":
      return { kind: "user", text: t.text, attachments: t.attachments };
    case "assistant":
      return { kind: "assistant", text: t.text, reasoning: "", open: false, model: t.model };
    case "tool":
      return { kind: "tool", id: t.id, name: t.name, args: t.args, result: t.result, status: "done" };
    case "error":
      return { kind: "error", text: t.text };
  }
}

function mergeAttachments(prev: Attachment[], next: Attachment[]): Attachment[] {
  const map = new Map(prev.map((a) => [a.path, a]));
  for (const a of next) {
    map.set(a.path, a);
  }
  return [...map.values()];
}
