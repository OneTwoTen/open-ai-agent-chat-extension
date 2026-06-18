import type { ModelMessage } from "ai";
import { ProviderId, ReasoningEffort } from "../providers/catalog";

const BUDGET: Record<Exclude<ReasoningEffort, "off">, number> = {
  low: 2048,
  medium: 8192,
  high: 24576,
};

/**
 * Heuristic: does this specific model support reasoning/extended thinking?
 * Reasoning is a model trait, not just a provider trait — e.g. OpenAI's
 * o-series reasons but gpt-4o does not, and Claude thinking needs 3.7/4.x.
 * Sending reasoning options to a model that lacks them causes API errors,
 * so we gate on the model id.
 */
export function modelSupportsReasoning(providerId: ProviderId, modelId: string): boolean {
  const m = (modelId || "").toLowerCase();
  switch (providerId) {
    case "openai":
    case "azure":
      return /(^|[^a-z])o[1-9]/.test(m) || m.includes("gpt-5") || m.includes("reasoning");
    case "anthropic":
    case "bedrock":
      return (
        m.includes("claude-3-7") ||
        m.includes("3-7-sonnet") ||
        m.includes("sonnet-4") ||
        m.includes("opus-4") ||
        m.includes("claude-4") ||
        m.includes("haiku-4") ||
        m.includes("-thinking")
      );
    case "google":
    case "vertex":
      return m.includes("gemini-2") || m.includes("thinking");
    case "deepseek":
      return m.includes("reasoner") || m.includes("r1");
    case "groq":
      return m.includes("r1") || m.includes("reasoning") || m.includes("qwq") || m.includes("o3");
    case "xai":
      return m.includes("grok-3") || m.includes("grok-4") || m.includes("reasoning");
    default:
      return false;
  }
}

/**
 * Map a reasoning-effort level to per-provider `providerOptions`.
 * Returns undefined when reasoning is off or the model can't reason.
 */
export function buildRequestProviderOptions(
  providerId: ProviderId,
  modelId: string,
  effort: ReasoningEffort
): Record<string, Record<string, unknown>> | undefined {
  if (effort === "off" || !modelSupportsReasoning(providerId, modelId)) {
    return undefined;
  }
  const budgetTokens = BUDGET[effort];
  switch (providerId) {
    case "openai":
    case "azure":
      return { openai: { reasoningEffort: effort } };
    case "anthropic":
    case "bedrock":
      return { anthropic: { thinking: { type: "enabled", budgetTokens } } };
    case "google":
    case "vertex":
      return {
        google: { thinkingConfig: { thinkingBudget: budgetTokens, includeThoughts: true } },
      };
    case "xai":
      return { xai: { reasoningEffort: effort } };
    case "groq":
      return { groq: { reasoningEffort: effort } };
    default:
      return undefined;
  }
}

/**
 * Choose a safe `maxOutputTokens` when reasoning is active. Anthropic/Bedrock
 * require max_tokens to exceed the thinking budget, so we add headroom for the
 * visible answer on top of the budget. Other reasoning models just get a
 * generous cap so reasoning + answer aren't truncated. Returns undefined when
 * reasoning is off/unsupported (use the provider default).
 */
export function maxOutputTokensFor(
  providerId: ProviderId,
  modelId: string,
  effort: ReasoningEffort
): number | undefined {
  if (effort === "off" || !modelSupportsReasoning(providerId, modelId)) {
    return undefined;
  }
  const budgetTokens = BUDGET[effort];
  if (providerId === "anthropic" || providerId === "bedrock") {
    return budgetTokens + 8192;
  }
  return Math.max(8192, budgetTokens);
}

/**
 * Build the leading system message. For providers with explicit prompt
 * caching (Anthropic, Bedrock) we attach a cacheControl breakpoint so the
 * large, stable system prompt is cached across turns.
 */
export function buildSystemMessage(systemText: string, providerId: ProviderId): ModelMessage {
  if (providerId === "anthropic" || providerId === "bedrock") {
    return {
      role: "system",
      content: systemText,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    } as ModelMessage;
  }
  return { role: "system", content: systemText };
}
