/**
 * Static metadata describing every LLM provider the extension supports.
 * Used to drive settings, the UI provider picker, and the registry.
 */

export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "vertex"
  | "azure"
  | "bedrock"
  | "mistral"
  | "cohere"
  | "groq"
  | "deepseek"
  | "fireworks"
  | "togetherai"
  | "xai"
  | "cerebras"
  | "perplexity"
  | "ollama"
  | "custom";

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  /** Whether a secret API key is required to use the provider. */
  requiresApiKey: boolean;
  /** Whether the provider accepts a custom base URL (OpenAI-compatible). */
  supportsBaseUrl: boolean;
  /** Suggested default model id. */
  defaultModel: string;
  /** A few well-known model ids to offer as suggestions. */
  exampleModels: string[];
  /** Default text-embedding model id, if the provider offers embeddings. */
  embeddingModel?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    requiresApiKey: true,
    supportsBaseUrl: true,
    defaultModel: "gpt-4o",
    exampleModels: ["gpt-4o", "gpt-4o-mini", "o3-mini", "gpt-4.1"],
    embeddingModel: "text-embedding-3-small",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    requiresApiKey: true,
    supportsBaseUrl: true,
    defaultModel: "claude-3-5-sonnet-20241022",
    exampleModels: [
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
    ],
  },
  google: {
    id: "google",
    label: "Google Gemini",
    requiresApiKey: true,
    supportsBaseUrl: false,
    defaultModel: "gemini-2.0-flash",
    exampleModels: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
    embeddingModel: "text-embedding-004",
  },
  vertex: {
    id: "vertex",
    label: "Google Vertex AI",
    requiresApiKey: false,
    supportsBaseUrl: false,
    defaultModel: "gemini-2.0-flash",
    exampleModels: ["gemini-2.0-flash", "gemini-1.5-pro"],
  },
  azure: {
    id: "azure",
    label: "Azure OpenAI",
    requiresApiKey: true,
    supportsBaseUrl: true,
    defaultModel: "gpt-4o",
    exampleModels: ["gpt-4o", "gpt-4o-mini"],
    embeddingModel: "text-embedding-3-small",
  },
  bedrock: {
    id: "bedrock",
    label: "Amazon Bedrock",
    requiresApiKey: false,
    supportsBaseUrl: false,
    defaultModel: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    exampleModels: [
      "anthropic.claude-3-5-sonnet-20241022-v2:0",
      "meta.llama3-1-70b-instruct-v1:0",
    ],
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    requiresApiKey: true,
    supportsBaseUrl: false,
    defaultModel: "mistral-large-latest",
    exampleModels: ["mistral-large-latest", "mistral-small-latest", "codestral-latest"],
    embeddingModel: "mistral-embed",
  },
  cohere: {
    id: "cohere",
    label: "Cohere",
    requiresApiKey: true,
    supportsBaseUrl: false,
    defaultModel: "command-r-plus",
    exampleModels: ["command-r-plus", "command-r"],
    embeddingModel: "embed-english-v3.0",
  },
  groq: {
    id: "groq",
    label: "Groq",
    requiresApiKey: true,
    supportsBaseUrl: false,
    defaultModel: "llama-3.3-70b-versatile",
    exampleModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    requiresApiKey: true,
    supportsBaseUrl: false,
    defaultModel: "deepseek-chat",
    exampleModels: ["deepseek-chat", "deepseek-reasoner"],
  },
  fireworks: {
    id: "fireworks",
    label: "Fireworks",
    requiresApiKey: true,
    supportsBaseUrl: false,
    defaultModel: "accounts/fireworks/models/llama-v3p1-70b-instruct",
    exampleModels: ["accounts/fireworks/models/llama-v3p1-70b-instruct"],
  },
  togetherai: {
    id: "togetherai",
    label: "Together AI",
    requiresApiKey: true,
    supportsBaseUrl: false,
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    exampleModels: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
  },
  xai: {
    id: "xai",
    label: "xAI Grok",
    requiresApiKey: true,
    supportsBaseUrl: false,
    defaultModel: "grok-2-latest",
    exampleModels: ["grok-2-latest", "grok-beta"],
  },
  cerebras: {
    id: "cerebras",
    label: "Cerebras",
    requiresApiKey: true,
    supportsBaseUrl: false,
    defaultModel: "llama-3.3-70b",
    exampleModels: ["llama-3.3-70b", "llama3.1-8b"],
  },
  perplexity: {
    id: "perplexity",
    label: "Perplexity",
    requiresApiKey: true,
    supportsBaseUrl: false,
    defaultModel: "sonar-pro",
    exampleModels: ["sonar-pro", "sonar"],
  },
  ollama: {
    id: "ollama",
    label: "Ollama (local)",
    requiresApiKey: false,
    supportsBaseUrl: true,
    defaultModel: "qwen2.5-coder",
    exampleModels: ["qwen2.5-coder", "llama3.1", "deepseek-coder-v2"],
    embeddingModel: "nomic-embed-text",
  },
  custom: {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    requiresApiKey: false,
    supportsBaseUrl: true,
    defaultModel: "",
    exampleModels: [],
    embeddingModel: "text-embedding-3-small",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(value: string): value is ProviderId {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}

/** What a provider can do — used for the capability display and gating. */
export interface ProviderCapabilities {
  tools: boolean;
  reasoning: boolean;
  images: boolean;
  /** Prompt-cache style: automatic, explicit breakpoints, or none. */
  promptCache: "auto" | "explicit" | "none";
}

export const CAPABILITIES: Record<ProviderId, ProviderCapabilities> = {
  openai: { tools: true, reasoning: true, images: true, promptCache: "auto" },
  anthropic: { tools: true, reasoning: true, images: true, promptCache: "explicit" },
  google: { tools: true, reasoning: true, images: true, promptCache: "auto" },
  vertex: { tools: true, reasoning: true, images: true, promptCache: "auto" },
  azure: { tools: true, reasoning: true, images: true, promptCache: "auto" },
  bedrock: { tools: true, reasoning: true, images: true, promptCache: "explicit" },
  mistral: { tools: true, reasoning: false, images: true, promptCache: "none" },
  cohere: { tools: true, reasoning: false, images: false, promptCache: "none" },
  groq: { tools: true, reasoning: true, images: false, promptCache: "none" },
  deepseek: { tools: true, reasoning: true, images: false, promptCache: "auto" },
  fireworks: { tools: true, reasoning: false, images: false, promptCache: "none" },
  togetherai: { tools: true, reasoning: false, images: false, promptCache: "none" },
  xai: { tools: true, reasoning: true, images: true, promptCache: "none" },
  cerebras: { tools: true, reasoning: false, images: false, promptCache: "none" },
  perplexity: { tools: false, reasoning: true, images: false, promptCache: "none" },
  ollama: { tools: true, reasoning: false, images: true, promptCache: "none" },
  custom: { tools: true, reasoning: false, images: false, promptCache: "none" },
};

/** Reasoning effort levels offered in the UI. */
export type ReasoningEffort = "off" | "low" | "medium" | "high";

/**
 * How much autonomy the agent has over mutating tools:
 * - readonly: write/delete/run tools are removed entirely
 * - ask: mutating tools require user confirmation
 * - auto: mutating tools run without prompting
 */
export type PermissionLevel = "readonly" | "ask" | "auto";

/** Tool names that mutate the workspace or run commands. */
export const MUTATING_TOOLS = [
  "write_file",
  "edit_file",
  "delete_file",
  "create_directory",
  "move_file",
  "run_command",
];

/** SecretStorage key for a provider's API key (or credential bundle). */
export function secretKeyFor(provider: ProviderId): string {
  return `aiAgentChat.apiKey.${provider}`;
}
