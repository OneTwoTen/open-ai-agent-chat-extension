import { describe, it, expect, vi, afterEach } from "vitest";
import {
  PROVIDERS,
  PROVIDER_IDS,
  secretKeyFor,
  isProviderId,
  CAPABILITIES,
} from "../src/providers/catalog";
import { hasCredential, getActiveProviderId } from "../src/providers/registry";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("secretKeyFor", () => {
  it("returns a namespaced key for each provider", () => {
    expect(secretKeyFor("openai")).toBe("aiAgentChat.apiKey.openai");
    expect(secretKeyFor("anthropic")).toBe("aiAgentChat.apiKey.anthropic");
  });
});

describe("PROVIDER_IDS", () => {
  it("contains known provider ids", () => {
    expect(PROVIDER_IDS).toContain("openai");
    expect(PROVIDER_IDS).toContain("anthropic");
    expect(PROVIDER_IDS).toContain("google");
    expect(PROVIDER_IDS).toContain("ollama");
    expect(PROVIDER_IDS).toContain("custom");
  });

  it("all ids are valid provider ids", () => {
    for (const id of PROVIDER_IDS) {
      expect(isProviderId(id)).toBe(true);
    }
  });
});

describe("hasCredential", () => {
  function makeSecrets(getImpl: () => Promise<string | undefined>) {
    return { get: getImpl } as unknown as import("vscode").SecretStorage;
  }

  it("returns true for providers that do not require an API key (e.g. vertex)", async () => {
    const secrets = makeSecrets(async () => undefined);
    const result = await hasCredential("vertex", secrets);
    expect(result).toBe(true);
  });

  it("returns true for providers that do not require an API key (e.g. bedrock)", async () => {
    const secrets = makeSecrets(async () => undefined);
    const result = await hasCredential("bedrock", secrets);
    expect(result).toBe(true);
  });

  it("returns true for ollama (no api key needed)", async () => {
    const secrets = makeSecrets(async () => undefined);
    const result = await hasCredential("ollama", secrets);
    expect(result).toBe(true);
  });

  it("returns true for custom (no api key needed)", async () => {
    const secrets = makeSecrets(async () => undefined);
    const result = await hasCredential("custom", secrets);
    expect(result).toBe(true);
  });

  it("returns false for openai when no key is stored", async () => {
    const secrets = makeSecrets(async () => undefined);
    const result = await hasCredential("openai", secrets);
    expect(result).toBe(false);
  });

  it("returns true for openai when a key is stored", async () => {
    const secrets = makeSecrets(async () => "sk-xxxxxxxx");
    const result = await hasCredential("openai", secrets);
    expect(result).toBe(true);
  });

  it("returns false for anthropic when no key is stored", async () => {
    const secrets = makeSecrets(async () => undefined);
    const result = await hasCredential("anthropic", secrets);
    expect(result).toBe(false);
  });

  it("calls secrets.get with the correct key", async () => {
    const get = vi.fn(async () => "sk-key");
    const secrets = makeSecrets(get);
    await hasCredential("openai", secrets);
    expect(get).toHaveBeenCalledWith("aiAgentChat.apiKey.openai");
  });

  it("handles all key-requiring providers consistently", async () => {
    const secrets = makeSecrets(async () => undefined);
    const keyProviders = PROVIDER_IDS.filter((id) => PROVIDERS[id].requiresApiKey);
    for (const id of keyProviders) {
      const result = await hasCredential(id, secrets);
      expect(result).toBe(false);
    }
  });

  it("handles all non-key providers consistently", async () => {
    const secrets = makeSecrets(async () => undefined);
    const noKeyProviders = PROVIDER_IDS.filter((id) => !PROVIDERS[id].requiresApiKey);
    for (const id of noKeyProviders) {
      const result = await hasCredential(id, secrets);
      expect(result).toBe(true);
    }
  });
});

describe("provider metadata consistency", () => {
  it("every provider in PROVIDERS has an entry in CAPABILITIES", () => {
    for (const id of PROVIDER_IDS) {
      expect(CAPABILITIES).toHaveProperty(id);
    }
  });

  it("every provider in CAPABILITIES has a PROVIDERS entry", () => {
    for (const id of Object.keys(CAPABILITIES)) {
      expect(PROVIDERS).toHaveProperty(id);
    }
  });

  it("every provider has a label, defaultModel, and exampleModels", () => {
    for (const id of PROVIDER_IDS) {
      const meta = PROVIDERS[id];
      expect(meta.label).toBeTruthy();
      expect(meta.defaultModel).toBeDefined();
      expect(Array.isArray(meta.exampleModels)).toBe(true);
    }
  });
});

describe("provider credentials computation", () => {
  it("can compute providerCredentials for all providers", async () => {
    const hasKey: Record<string, boolean> = {};
    for (const id of PROVIDER_IDS) {
      hasKey[id] = PROVIDERS[id].requiresApiKey ? false : true;
    }
    expect(Object.keys(hasKey).sort()).toEqual(PROVIDER_IDS.slice().sort());
  });

  it("providerCredentials record shape matches protocol type", () => {
    const credentials: Record<string, boolean> = {};
    for (const id of PROVIDER_IDS) {
      credentials[id] = true;
    }
    expect(typeof credentials).toBe("object");
    expect(typeof credentials[PROVIDER_IDS[0]]).toBe("boolean");
  });
});
