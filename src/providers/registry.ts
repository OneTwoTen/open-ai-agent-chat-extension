import type { EmbeddingModel, LanguageModel } from "ai";
import * as vscode from "vscode";
import { ProviderId, PROVIDERS, secretKeyFor } from "./catalog";

/** Read a setting under the aiAgentChat namespace. */
function cfg<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration("aiAgentChat").get<T>(key, fallback);
}

export function getActiveProviderId(): ProviderId {
  return cfg<ProviderId>("provider", "openai");
}

/** Resolve the model id for the active provider (override or catalog default). */
export function getActiveModelId(provider: ProviderId): string {
  const override = cfg<string>("model", "");
  return override?.trim() || PROVIDERS[provider].defaultModel;
}

/**
 * Build a provider instance for the given id, injecting credentials from
 * SecretStorage and connection settings from configuration.
 * Returns an object that is callable with a model id.
 */
async function buildProvider(
  id: ProviderId,
  secrets: vscode.SecretStorage
): Promise<(modelId: string) => LanguageModel> {
  const apiKey = await secrets.get(secretKeyFor(id));
  const baseURL = cfg<string>("baseUrl", "") || undefined;

  switch (id) {
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({ apiKey, baseURL }) as never;
    }
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic({ apiKey, baseURL }) as never;
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      return createGoogleGenerativeAI({ apiKey }) as never;
    }
    case "vertex": {
      const { createVertex } = await import("@ai-sdk/google-vertex");
      return createVertex({
        project: cfg<string>("vertex.project", "") || undefined,
        location: cfg<string>("vertex.location", "us-central1"),
      }) as never;
    }
    case "azure": {
      const { createAzure } = await import("@ai-sdk/azure");
      return createAzure({
        apiKey,
        resourceName: cfg<string>("azure.resourceName", "") || undefined,
        baseURL,
      }) as never;
    }
    case "bedrock": {
      const { createAmazonBedrock } = await import("@ai-sdk/amazon-bedrock");
      return createAmazonBedrock({
        region: cfg<string>("bedrock.region", "us-east-1"),
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      }) as never;
    }
    case "mistral": {
      const { createMistral } = await import("@ai-sdk/mistral");
      return createMistral({ apiKey }) as never;
    }
    case "cohere": {
      const { createCohere } = await import("@ai-sdk/cohere");
      return createCohere({ apiKey }) as never;
    }
    case "groq": {
      const { createGroq } = await import("@ai-sdk/groq");
      return createGroq({ apiKey }) as never;
    }
    case "deepseek": {
      const { createDeepSeek } = await import("@ai-sdk/deepseek");
      return createDeepSeek({ apiKey }) as never;
    }
    case "fireworks": {
      const { createFireworks } = await import("@ai-sdk/fireworks");
      return createFireworks({ apiKey }) as never;
    }
    case "togetherai": {
      const { createTogetherAI } = await import("@ai-sdk/togetherai");
      return createTogetherAI({ apiKey }) as never;
    }
    case "xai": {
      const { createXai } = await import("@ai-sdk/xai");
      return createXai({ apiKey }) as never;
    }
    case "cerebras": {
      const { createCerebras } = await import("@ai-sdk/cerebras");
      return createCerebras({ apiKey }) as never;
    }
    case "perplexity": {
      const { createPerplexity } = await import("@ai-sdk/perplexity");
      return createPerplexity({ apiKey }) as never;
    }
    case "ollama": {
      const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
      const url = baseURL || "http://localhost:11434/v1";
      return createOpenAICompatible({ name: "ollama", baseURL: url, apiKey: apiKey || "ollama" }) as never;
    }
    case "custom":
    default: {
      const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
      const url = baseURL || "http://localhost:8000/v1";
      return createOpenAICompatible({ name: "custom", baseURL: url, apiKey }) as never;
    }
  }
}

/** A language model plus identifying metadata. */
export interface ActiveModel {
  model: LanguageModel;
  providerId: ProviderId;
  modelId: string;
}

/** Build the language model for the currently active provider/model. */
export async function getActiveModel(
  secrets: vscode.SecretStorage
): Promise<ActiveModel> {
  const providerId = getActiveProviderId();
  const modelId = getActiveModelId(providerId);
  const provider = await buildProvider(providerId, secrets);
  return { model: provider(modelId), providerId, modelId };
}

/** Build a language model for an explicit provider/model (e.g. agent override). */
export async function getModelFor(
  providerId: ProviderId,
  modelId: string,
  secrets: vscode.SecretStorage
): Promise<LanguageModel> {
  const provider = await buildProvider(providerId, secrets);
  return provider(modelId || PROVIDERS[providerId].defaultModel);
}

/** Whether the active (or given) provider has a usable credential. */
export async function hasCredential(
  provider: ProviderId,
  secrets: vscode.SecretStorage
): Promise<boolean> {
  const meta = PROVIDERS[provider];
  if (!meta.requiresApiKey) {
    return true;
  }
  const key = await secrets.get(secretKeyFor(provider));
  return !!key;
}

/**
 * Build a text-embedding model for the configured embeddings provider.
 * Falls back to the active provider when none is configured.
 */
export async function getEmbeddingModel(
  secrets: vscode.SecretStorage
): Promise<EmbeddingModel> {
  const embProvider = cfg<ProviderId>("embeddings.provider", "openai");
  const meta = PROVIDERS[embProvider];
  const modelId =
    cfg<string>("embeddings.model", "") || meta.embeddingModel || "text-embedding-3-small";
  const provider = (await buildProvider(embProvider, secrets)) as unknown as {
    textEmbeddingModel?: (id: string) => EmbeddingModel;
  };
  if (typeof provider.textEmbeddingModel !== "function") {
    throw new Error(
      `Provider '${embProvider}' does not support embeddings. ` +
        `Set 'aiAgentChat.embeddings.provider' to one that does (e.g. openai).`
    );
  }
  return provider.textEmbeddingModel(modelId);
}
