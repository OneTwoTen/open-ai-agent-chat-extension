import { describe, expect, it } from "vitest";
import {
  buildRequestProviderOptions,
  buildSystemMessage,
  maxOutputTokensFor,
  modelSupportsReasoning,
} from "../src/agent/providerTuning";

describe("modelSupportsReasoning", () => {
  it("recognizes OpenAI o-series but not gpt-4o", () => {
    expect(modelSupportsReasoning("openai", "o3-mini")).toBe(true);
    expect(modelSupportsReasoning("openai", "o1")).toBe(true);
    expect(modelSupportsReasoning("openai", "gpt-4o")).toBe(false);
    expect(modelSupportsReasoning("openai", "gpt-4o-mini")).toBe(false);
  });

  it("recognizes Claude 3.7/4 thinking but not 3.5", () => {
    expect(modelSupportsReasoning("anthropic", "claude-3-7-sonnet")).toBe(true);
    expect(modelSupportsReasoning("anthropic", "claude-sonnet-4")).toBe(true);
    expect(modelSupportsReasoning("anthropic", "claude-3-5-sonnet-20241022")).toBe(false);
  });

  it("recognizes other reasoning models", () => {
    expect(modelSupportsReasoning("google", "gemini-2.0-flash")).toBe(true);
    expect(modelSupportsReasoning("deepseek", "deepseek-reasoner")).toBe(true);
    expect(modelSupportsReasoning("deepseek", "deepseek-chat")).toBe(false);
    expect(modelSupportsReasoning("xai", "grok-3")).toBe(true);
    expect(modelSupportsReasoning("groq", "llama-3.3-70b-versatile")).toBe(false);
  });

  it("returns false for non-reasoning providers", () => {
    expect(modelSupportsReasoning("mistral", "mistral-large-latest")).toBe(false);
    expect(modelSupportsReasoning("ollama", "qwen2.5-coder")).toBe(false);
  });
});

describe("buildRequestProviderOptions", () => {
  it("returns undefined when reasoning is off", () => {
    expect(buildRequestProviderOptions("openai", "o3", "off")).toBeUndefined();
  });

  it("returns undefined when the model can't reason, even if effort is set", () => {
    expect(buildRequestProviderOptions("openai", "gpt-4o", "high")).toBeUndefined();
    expect(buildRequestProviderOptions("anthropic", "claude-3-5-sonnet", "high")).toBeUndefined();
  });

  it("maps OpenAI effort to reasoningEffort", () => {
    expect(buildRequestProviderOptions("openai", "o3", "medium")).toEqual({
      openai: { reasoningEffort: "medium" },
    });
  });

  it("maps Anthropic effort to a thinking budget", () => {
    expect(buildRequestProviderOptions("anthropic", "claude-3-7-sonnet", "low")).toEqual({
      anthropic: { thinking: { type: "enabled", budgetTokens: 2048 } },
    });
  });

  it("maps Google effort to a thinking config", () => {
    const opts = buildRequestProviderOptions("google", "gemini-2.0-flash", "high");
    expect(opts).toEqual({
      google: { thinkingConfig: { thinkingBudget: 24576, includeThoughts: true } },
    });
  });
});

describe("maxOutputTokensFor", () => {
  it("is undefined when reasoning is off or unsupported", () => {
    expect(maxOutputTokensFor("anthropic", "claude-3-7-sonnet", "off")).toBeUndefined();
    expect(maxOutputTokensFor("openai", "gpt-4o", "high")).toBeUndefined();
  });

  it("exceeds the Anthropic thinking budget", () => {
    expect(maxOutputTokensFor("anthropic", "claude-3-7-sonnet", "medium")).toBe(8192 + 8192);
    expect(maxOutputTokensFor("bedrock", "claude-sonnet-4", "high")).toBe(24576 + 8192);
  });

  it("gives a generous cap for other reasoning models", () => {
    expect(maxOutputTokensFor("openai", "o3", "low")).toBe(8192);
    expect(maxOutputTokensFor("openai", "o3", "high")).toBe(24576);
  });
});

describe("buildSystemMessage", () => {
  it("adds a cacheControl breakpoint for Anthropic/Bedrock", () => {
    const msg = buildSystemMessage("SYSTEM", "anthropic") as {
      role: string;
      providerOptions?: { anthropic?: { cacheControl?: { type: string } } };
    };
    expect(msg.role).toBe("system");
    expect(msg.providerOptions?.anthropic?.cacheControl).toEqual({ type: "ephemeral" });
  });

  it("leaves other providers without cache markers", () => {
    const msg = buildSystemMessage("SYSTEM", "openai") as { providerOptions?: unknown };
    expect(msg.providerOptions).toBeUndefined();
  });
});
