import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchModels } from "../src/providers/models";
import { isProviderId } from "../src/providers/catalog";

const secrets = { get: async () => "KEY" } as unknown as import("vscode").SecretStorage;
const noSecrets = { get: async () => undefined } as unknown as import("vscode").SecretStorage;

function mockFetchOnce(shape: unknown, ok = true) {
  const fn = vi.fn(async () => ({ ok, json: async () => shape }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider ids", () => {
  it("rejects unknown provider ids before settings use them", () => {
    expect(isProviderId("openai")).toBe(true);
    expect(isProviderId("not-a-provider")).toBe(false);
    expect(isProviderId("")).toBe(false);
  });
});

describe("fetchModels", () => {
  it("parses OpenAI-compatible /models data[].id and sorts", async () => {
    const fn = mockFetchOnce({ data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o" }, { id: "o3" }] });
    const models = await fetchModels("openai", secrets);
    expect(models).toEqual(["gpt-4o", "gpt-4o-mini", "o3"]);
    expect(fn).toHaveBeenCalledOnce();
    expect(String(fn.mock.calls[0][0])).toContain("/models");
  });

  it("parses Anthropic models and sends the api key header", async () => {
    const fn = mockFetchOnce({ data: [{ id: "claude-3-7-sonnet" }, { id: "claude-3-5-haiku" }] });
    const models = await fetchModels("anthropic", secrets);
    expect(models).toEqual(["claude-3-5-haiku", "claude-3-7-sonnet"]);
    const headers = (fn.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(headers["x-api-key"]).toBe("KEY");
  });

  it("parses Ollama /api/tags models[].name", async () => {
    const fn = mockFetchOnce({ models: [{ name: "qwen2.5-coder" }, { name: "llama3.1" }] });
    const models = await fetchModels("ollama", noSecrets); // ollama needs no key
    expect(models).toEqual(["llama3.1", "qwen2.5-coder"]);
    expect(String(fn.mock.calls[0][0])).toContain("/api/tags");
  });

  it("filters Google models to generateContent-capable", async () => {
    mockFetchOnce({
      models: [
        { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
      ],
    });
    const models = await fetchModels("google", secrets);
    expect(models).toEqual(["gemini-2.0-flash"]);
  });

  it("returns [] for providers without a listing endpoint", async () => {
    const fn = mockFetchOnce({ data: [] });
    expect(await fetchModels("bedrock", secrets)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns [] when a key is required but missing", async () => {
    const fn = mockFetchOnce({ data: [{ id: "x" }] });
    expect(await fetchModels("anthropic", noSecrets)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns [] on a non-ok response", async () => {
    mockFetchOnce({ error: "unauthorized" }, false);
    expect(await fetchModels("openai", secrets)).toEqual([]);
  });
});
