import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAgentTurn } from "../src/telegram/handlers";
import { eventBus } from "../src/shared/eventBus";
import { Bot } from "grammy";

// Mock dependencies
vi.mock("../src/agent/agent", () => ({
  AgentManager: vi.fn().mockImplementation(() => ({
    // Mock agent methods
  })),
}));

vi.mock("../src/sessions", () => ({
  SessionStore: vi.fn().mockImplementation(() => ({
    save: vi.fn().mockResolvedValue(undefined),
  })),
  titleFrom: vi.fn(),
}));

vi.mock("../src/shared/eventBus", () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  },
}));

describe("runAgentTurn Event Emission", () => {
  let mockBot: any;
  let mockSession: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBot = {
      api: {
        sendMessage: vi.fn().mockResolvedValue({}),
        sendChatAction: vi.fn().mockResolvedValue({}),
      },
    };
    mockSession = {
      agentId: "coder",
      sessionId: "session-123",
      agentSession: {
        run: vi.fn().mockResolvedValue({}),
        getHistory: vi.fn().mockReturnValue([]),
      },
    };
  });

  it("should emit full activity lifecycle on successful turn", async () => {
    const chatId = 123;
    const text = "Hello agent";
    
    // Mock the a session loading mechanism (since runAgentTurn handles session)
    // Note: In real code runAgentTurn gets session from SessionStore
    // We might need to mock the SessionStore.get method
    const { SessionStore } = await import("../src/sessions");
    (SessionStore.prototype.get as any) = vi.fn().mockResolvedValue(mockSession);

    await runAgentTurn(mockBot, chatId, text, [], {});

    // 1. messageReceived
    expect(eventBus.emit).toHaveBeenCalledWith("telegram:activity", expect.objectContaining({
      type: "messageReceived",
      chatId,
      data: expect.objectContaining({ text: expect.stringContaining("Hello agent") })
    }));

    // 2. turnStarted
    expect(eventBus.emit).toHaveBeenCalledWith("telegram:activity", expect.objectContaining({
      type: "turnStarted",
      chatId,
    }));

    // 3. turnCompleted
    expect(eventBus.emit).toHaveBeenCalledWith("telegram:activity", expect.objectContaining({
      type: "turnCompleted",
      chatId,
    }));

    // 4. sessionUpdated
    expect(eventBus.emit).toHaveBeenCalledWith("telegram:session", expect.objectContaining({
      type: "sessionUpdated",
      chatId,
      sessionId: "session-123",
    }));
  });

  it("should emit error event when agent execution fails", async () => {
    const chatId = 456;
    const text = "Trigger error";
    
    const { SessionStore } = await import("../src/sessions");
    (SessionStore.prototype.get as any) = vi.fn().mockResolvedValue(mockSession);
    
    mockSession.agentSession.run.mockRejectedValue(new Error("Agent crash"));

    await runAgentTurn(mockBot, chatId, text, [], {});

    expect(eventBus.emit).toHaveBeenCalledWith("telegram:activity", expect.objectContaining({
      type: "error",
      chatId,
      data: expect.objectContaining({ message: "Agent crash" })
    }));
  });
});
