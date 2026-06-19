import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { eventBus } from "../src/shared/eventBus";

// Mock vscode module
vi.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/tmp/ws" } }],
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(undefined),
    }),
  },
  Uri: { file: vi.fn((p: string) => ({ fsPath: p })) },
  SecretStorage: {},
}));

// Mock grammy Bot
vi.mock("grammy", () => ({
  Bot: vi.fn().mockImplementation(() => ({
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
      sendChatAction: vi.fn().mockResolvedValue({}),
      editMessageText: vi.fn().mockResolvedValue({}),
    },
  })),
  InlineKeyboard: vi.fn().mockImplementation(() => ({
    text: vi.fn().mockReturnThis(),
  })),
}));

// Mock agent modules
vi.mock("../src/agent/agents", () => ({
  AgentManager: vi.fn().mockImplementation(() => ({
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../src/agent/skills", () => ({
  SkillManager: vi.fn().mockImplementation(() => ({
    alwaysApplyText: vi.fn().mockResolvedValue(""),
  })),
  loadProjectRules: vi.fn().mockResolvedValue(""),
}));

vi.mock("../src/agent/memory", () => ({
  MemoryStore: vi.fn().mockImplementation(() => ({
    read: vi.fn().mockResolvedValue(""),
  })),
}));

vi.mock("../src/agent/embeddings", () => ({
  RepoIndex: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../src/agent/mcp", () => ({
  McpManager: vi.fn().mockImplementation(() => ({
    connectAll: vi.fn().mockResolvedValue(undefined),
    getTools: vi.fn().mockReturnValue({}),
  })),
}));

vi.mock("../src/providers", () => ({
  getActiveModel: vi.fn().mockResolvedValue({ model: {} }),
  getActiveProviderId: vi.fn().mockReturnValue("openai"),
  getActiveModelId: vi.fn().mockReturnValue("gpt-4o"),
  getModelFor: vi.fn().mockResolvedValue({}),
  getEmbeddingModel: vi.fn().mockResolvedValue({}),
  PROVIDERS: {},
}));

vi.mock("../src/sessions", () => ({
  SessionStore: vi.fn().mockImplementation(() => ({
    save: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(null),
  })),
  titleFrom: vi.fn().mockReturnValue("test session"),
}));

describe("Telegram Event Bus Integration", () => {
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    emitSpy = vi.spyOn(eventBus, "emit");
  });

  afterEach(() => {
    emitSpy.mockRestore();
  });

  it("eventBus.emit is callable and tracks calls", async () => {
    // Simple test to verify eventBus mock works
    eventBus.emit("telegram:activity", {
      type: "test",
      chatId: 123,
      timestamp: Date.now(),
      data: {},
    });

    expect(emitSpy).toHaveBeenCalledWith("telegram:activity", expect.objectContaining({
      type: "test",
      chatId: 123,
    }));
  });

  it("eventBus tracks multiple emits", async () => {
    eventBus.emit("telegram:activity", { type: "a", chatId: 1, timestamp: Date.now(), data: {} });
    eventBus.emit("telegram:activity", { type: "b", chatId: 2, timestamp: Date.now(), data: {} });

    expect(emitSpy).toHaveBeenCalledTimes(2);
  });
});
