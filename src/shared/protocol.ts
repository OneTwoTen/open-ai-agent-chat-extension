/**
 * Message protocol shared between the extension host and the webview UI.
 * Provider/agent ids are plain strings; the host supplies catalogs.
 */

export type ReasoningEffort = "off" | "low" | "medium" | "high";
export type PermissionLevel = "readonly" | "ask" | "auto";

export interface ProviderCapabilities {
  tools: boolean;
  reasoning: boolean;
  images: boolean;
  promptCache: "auto" | "explicit" | "none";
}

export interface ProviderInfo {
  id: string;
  label: string;
  requiresApiKey: boolean;
  exampleModels: string[];
  capabilities: ProviderCapabilities;
  supportsBaseUrl: boolean;
}

export interface ProviderConnectionSettings {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
}

export interface FileAnalysisSettings {
  enabled: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
}

export interface FileAnalysisUpdate {
  enabled: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
}

/** Full agent definition for the config editor. */
export interface AgentDTO {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[] | "all";
  provider?: string;
  model?: string;
  skills?: string[];
  /** Ids of agents this agent may delegate to as sub-agents. */
  subAgents?: string[];
  builtIn?: boolean;
}

export interface SkillDTO {
  name: string;
  description: string;
  alwaysApply: boolean;
  body: string;
}

export interface ToolCatalogItem {
  name: string;
  description: string;
  mutating: boolean;
  source: "builtin" | "mcp";
}

export type McpTransport = "stdio" | "sse" | "http";

export interface McpServerConfig {
  id: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
}

export interface McpServerStatus {
  id: string;
  transport: McpTransport;
  enabled: boolean;
  status: "connected" | "disconnected" | "error";
  toolCount: number;
  tools: string[];
  error?: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: number;
}

export interface Attachment {
  path: string;
  content: string;
  /** For image attachments, the base64-encoded data URL. */
  imageUrl?: string;
  /** Base64 file payload for model-side file analysis (e.g. PDFs). */
  dataBase64?: string;
  /** MIME type for image or file attachments (e.g., "image/png", "application/pdf"). */
  mimeType?: string;
}

/** A workspace file or folder reference for the # mention picker. */
export interface FileRef {
  path: string;
  fsPath: string;
  kind: "file" | "folder";
}

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

/** Token usage for a single model call (step), labelled by the tools it ran. */
export interface StepUsage {
  tools: string[];
  usage: UsageStats;
}

export type TranscriptItem =
  | { kind: "user"; text: string; attachments?: string[] }
  | { kind: "assistant"; text: string; model?: string }
  | { kind: "tool"; id: string; name: string; args: unknown; result?: string }
  | { kind: "error"; text: string };

export type WebviewToHost =
  | { type: "ready" }
  | { type: "sendMessage"; text: string; attachments: Attachment[] }
  | { type: "cancel" }
  | { type: "newChat" }
  | { type: "selectProvider"; provider: string }
  | { type: "selectModel"; model: string }
  | { type: "saveProviderSettings"; settings: ProviderConnectionSettings }
  | { type: "saveFileAnalysisSettings"; settings: FileAnalysisUpdate }
  | { type: "listModels"; provider: string; refresh?: boolean }
  | { type: "selectAgent"; agentId: string }
  | { type: "selectReasoning"; effort: ReasoningEffort }
  | { type: "selectPermission"; level: PermissionLevel }
  | { type: "setApiKey" }
  | { type: "buildIndex" }
  | { type: "requestSessions" }
  | { type: "loadSession"; id: string }
  | { type: "deleteSession"; id: string }
  | { type: "pickFiles" }
  | { type: "readDroppedPaths"; paths: string[] }
  | { type: "searchFiles"; query: string }
  | { type: "openInEditor" }
  | { type: "openExternal"; url: string }
  | { type: "exportMarkdown" }
  | { type: "insertAtCursor"; code: string }
  | { type: "insertIntoNewFile"; code: string }
  | { type: "addContext"; kind: "selection" | "editor" | "problems" | "changes" }
  | { type: "analyzeSessions"; ids: string[] }
  | { type: "listAgents" }
  | { type: "saveAgent"; agent: AgentDTO }
  | { type: "deleteAgent"; id: string }
  | { type: "listSkills" }
  | { type: "saveSkill"; skill: SkillDTO }
  | { type: "deleteSkill"; name: string }
  | { type: "listMcp" }
  | { type: "saveMcpServer"; server: McpServerConfig }
  | { type: "deleteMcpServer"; id: string }
  | { type: "reconnectMcp" }
  | { type: "getTelegramStatus" }
  | { type: "startTelegram" }
  | { type: "stopTelegram" }
  | { type: "setTelegramToken"; token: string }
  | { type: "updateTelegramConfig"; config: TelegramConfigUpdate };

export type HostToWebview =
  | {
      type: "init";
      providers: ProviderInfo[];
      provider: string;
      model: string;
      agents: AgentInfo[];
      agentId: string;
      hasApiKey: boolean;
      baseUrl: string;
      fileAnalysis: FileAnalysisSettings;
      indexSize: number;
      reasoning: ReasoningEffort;
      permission: PermissionLevel;
    }
  | { type: "assistantDelta"; text: string }
  | { type: "reasoningDelta"; text: string }
  | { type: "toolCall"; id: string; name: string; args: unknown }
  | { type: "toolResult"; id: string; name: string; result: string }
  | { type: "done" }
  | { type: "error"; message: string }
  | { type: "busy"; value: boolean }
  | { type: "note"; text: string }
  | { type: "cleared" }
  | { type: "providerChanged"; provider: string; model: string; hasApiKey: boolean }
  | { type: "models"; provider: string; models: string[]; fetched: boolean }
  | { type: "turnMeta"; label: string }
  | { type: "agentChanged"; agentId: string }
  | { type: "reasoningChanged"; effort: ReasoningEffort }
  | { type: "permissionChanged"; level: PermissionLevel }
  | { type: "sessions"; list: SessionSummary[] }
  | { type: "sessionLoaded"; id: string; items: TranscriptItem[] }
  | { type: "attachmentsResolved"; attachments: Attachment[] }
  | { type: "fileResults"; query: string; items: FileRef[] }
  | { type: "usage"; turn: UsageStats; session: UsageStats; steps: StepUsage[] }
  | { type: "agentsList"; agents: AgentDTO[]; toolCatalog: ToolCatalogItem[] }
  | { type: "skillsList"; skills: SkillDTO[] }
  | { type: "mcpStatus"; servers: McpServerStatus[] }
  | { type: "telegramStatus"; status: TelegramStatus }
  | { type: "telegramActivity"; item: TelegramActivityItem }
  | { type: "workingSet"; files: WorkingSetFile[] };

/** A file in the working set with its modification status. */
export interface WorkingSetFile {
  path: string;
  status: "created" | "modified" | "deleted" | "moved";
  timestamp: number;
  /** For moved files, the original path. */
  fromPath?: string;
}

/** Telegram bot status for the UI panel. */
export interface TelegramStatus {
  running: boolean;
  chatCount: number;
  uptime: number;
  allowedChatIds: number[];
  workspacePath: string;
  startOnActivation: boolean;
  proxyUrl: string;
}

/** Real-time activity item from a Telegram chat. */
export interface TelegramActivityItem {
  id: string;
  chatId: number;
  type: "messageReceived" | "turnStarted" | "turnCompleted" | "toolCalled" | "toolResult" | "error" | "fileChanged";
  timestamp: number;
  summary: string;
  details?: Record<string, unknown>;
}

/** Telegram bot configuration update from the UI. */
export interface TelegramConfigUpdate {
  allowedChatIds: number[];
  workspacePath: string;
  startOnActivation: boolean;
  proxyUrl: string;
}
