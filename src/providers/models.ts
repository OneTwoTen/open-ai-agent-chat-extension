import * as vscode from "vscode";
import { ProviderId, secretKeyFor } from "./catalog";

function cfg<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration("aiAgentChat").get<T>(key, fallback);
}

/** Default base URLs for OpenAI-compatible `/models` endpoints. */
const OPENAI_COMPAT_BASE: Partial<Record<ProviderId, string>> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com",
  fireworks: "https://api.fireworks.ai/inference/v1",
  togetherai: "https://api.together.xyz/v1",
  xai: "https://api.x.ai/v1",
  cerebras: "https://api.cerebras.ai/v1",
  mistral: "https://api.mistral.ai/v1",
};

async function getJson(
  url: string,
  headers: Record<string, string> = {}
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function idsFromData(json: Record<string, unknown> | null): string[] {
  const data = json?.data;
  if (!Array.isArray(data)) {
    return [];
  }
  return uniqueSorted(
    data.map((x) => String((x as { id?: unknown }).id ?? "")).filter(Boolean)
  );
}

function uniqueSorted(items: string[]): string[] {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b));
}

/**
 * Fetch the list of models a provider currently exposes. Returns [] when the
 * provider has no listing endpoint, the key is missing, or the request fails —
 * the caller then falls back to the static example models.
 */
export async function fetchModels(
  provider: ProviderId,
  secrets: vscode.SecretStorage
): Promise<string[]> {
  const key = await secrets.get(secretKeyFor(provider));
  const baseOverride = cfg<string>("baseUrl", "").trim();

  switch (provider) {
    case "anthropic": {
      if (!key) return [];
      const j = await getJson("https://api.anthropic.com/v1/models?limit=1000", {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      });
      return idsFromData(j);
    }

    case "google": {
      if (!key) return [];
      const j = await getJson(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=1000`
      );
      const models = (j?.models as Array<Record<string, unknown>>) ?? [];
      return uniqueSorted(
        models
          .filter((m) =>
            (m.supportedGenerationMethods as string[] | undefined)?.includes("generateContent")
          )
          .map((m) => String(m.name ?? "").replace(/^models\//, ""))
          .filter(Boolean)
      );
    }

    case "cohere": {
      if (!key) return [];
      const j = await getJson("https://api.cohere.com/v1/models?page_size=1000", {
        Authorization: `Bearer ${key}`,
      });
      const models = (j?.models as Array<Record<string, unknown>>) ?? [];
      return uniqueSorted(models.map((m) => String(m.name ?? "")).filter(Boolean));
    }

    case "ollama": {
      const base = (baseOverride || "http://localhost:11434").replace(/\/v1\/?$/, "");
      const j = await getJson(`${base.replace(/\/$/, "")}/api/tags`);
      const models = (j?.models as Array<Record<string, unknown>>) ?? [];
      return uniqueSorted(models.map((m) => String(m.name ?? "")).filter(Boolean));
    }

    case "openai":
    case "groq":
    case "deepseek":
    case "fireworks":
    case "togetherai":
    case "xai":
    case "cerebras":
    case "mistral":
    case "custom": {
      const base =
        (provider === "openai" || provider === "custom") && baseOverride
          ? baseOverride
          : OPENAI_COMPAT_BASE[provider] || baseOverride;
      if (!base || (!key && provider !== "custom")) {
        return [];
      }
      const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
      const j = await getJson(`${base.replace(/\/$/, "")}/models`, headers);
      return idsFromData(j);
    }

    // azure, bedrock, vertex, perplexity: no simple listing -> use static list
    default:
      return [];
  }
}
