import { describe, it, expect, vi, beforeEach } from "vitest";
import { eventBus, TelegramActivityEvent, TelegramSessionEvent } from "../src/shared/eventBus";

describe("EventBus", () => {
  beforeEach(() => {
    eventBus.removeAllListeners();
  });

  describe("on/emit", () => {
    it("should register and call handler when event is emitted", () => {
      const handler = vi.fn();
      eventBus.on("telegram:activity", handler);

      const event: TelegramActivityEvent = {
        type: "messageReceived",
        chatId: 123,
        timestamp: Date.now(),
        data: { text: "hello" },
      };
      eventBus.emit("telegram:activity", event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it("should support multiple handlers for the same event", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      eventBus.on("telegram:activity", handler1);
      eventBus.on("telegram:activity", handler2);

      const event: TelegramActivityEvent = {
        type: "turnStarted",
        chatId: 456,
        timestamp: Date.now(),
        data: { agentId: "coder" },
      };
      eventBus.emit("telegram:activity", event);

      expect(handler1).toHaveBeenCalledWith(event);
      expect(handler2).toHaveBeenCalledWith(event);
    });

    it("should not call handlers for different events", () => {
      const activityHandler = vi.fn();
      const sessionHandler = vi.fn();
      eventBus.on("telegram:activity", activityHandler);
      eventBus.on("telegram:session", sessionHandler);

      const event: TelegramActivityEvent = {
        type: "turnCompleted",
        chatId: 789,
        timestamp: Date.now(),
        data: {},
      };
      eventBus.emit("telegram:activity", event);

      expect(activityHandler).toHaveBeenCalled();
      expect(sessionHandler).not.toHaveBeenCalled();
    });

    it("should return unsubscribe function", () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.on("telegram:activity", handler);

      const event: TelegramActivityEvent = {
        type: "error",
        chatId: 111,
        timestamp: Date.now(),
        data: { message: "test error" },
      };
      eventBus.emit("telegram:activity", event);
      expect(handler).toHaveBeenCalled();

      handler.mockClear();
      unsubscribe();
      eventBus.emit("telegram:activity", event);
      expect(handler).not.toHaveBeenCalled();
    });

    it("should handle errors in handlers gracefully", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const badHandler = () => {
        throw new Error("Handler error");
      };
      const goodHandler = vi.fn();

      eventBus.on("telegram:activity", badHandler);
      eventBus.on("telegram:activity", goodHandler);

      const event: TelegramActivityEvent = {
        type: "messageReceived",
        chatId: 222,
        timestamp: Date.now(),
        data: {},
      };

      // Should not throw
      eventBus.emit("telegram:activity", event);

      expect(goodHandler).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("telegram:activity events", () => {
    it("should emit messageReceived event with correct data", () => {
      const handler = vi.fn();
      eventBus.on("telegram:activity", handler);

      const event: TelegramActivityEvent = {
        type: "messageReceived",
        chatId: 100,
        timestamp: 1234567890,
        data: { text: "test message", agentId: "coder", hasAttachments: false },
      };
      eventBus.emit("telegram:activity", event);

      expect(handler).toHaveBeenCalledWith(event);
      expect(handler.mock.calls[0][0].type).toBe("messageReceived");
      expect(handler.mock.calls[0][0].chatId).toBe(100);
    });

    it("should emit turnStarted event with correct data", () => {
      const handler = vi.fn();
      eventBus.on("telegram:activity", handler);

      const event: TelegramActivityEvent = {
        type: "turnStarted",
        chatId: 200,
        timestamp: 1234567890,
        data: { agentId: "coder", providerId: "openai", modelId: "gpt-4o" },
      };
      eventBus.emit("telegram:activity", event);

      expect(handler).toHaveBeenCalledWith(event);
      expect(handler.mock.calls[0][0].type).toBe("turnStarted");
    });

    it("should emit toolCalled event with correct data", () => {
      const handler = vi.fn();
      eventBus.on("telegram:activity", handler);

      const event: TelegramActivityEvent = {
        type: "toolCalled",
        chatId: 300,
        timestamp: 1234567890,
        data: { toolName: "read_file", args: { path: "test.ts" } },
      };
      eventBus.emit("telegram:activity", event);

      expect(handler).toHaveBeenCalledWith(event);
      expect(handler.mock.calls[0][0].data.toolName).toBe("read_file");
    });

    it("should emit error event with correct data", () => {
      const handler = vi.fn();
      eventBus.on("telegram:activity", handler);

      const event: TelegramActivityEvent = {
        type: "error",
        chatId: 400,
        timestamp: 1234567890,
        data: { message: "Something went wrong" },
      };
      eventBus.emit("telegram:activity", event);

      expect(handler).toHaveBeenCalledWith(event);
      expect(handler.mock.calls[0][0].data.message).toBe("Something went wrong");
    });
  });

  describe("telegram:session events", () => {
    it("should emit sessionCreated event", () => {
      const handler = vi.fn();
      eventBus.on("telegram:session", handler);

      const event: TelegramSessionEvent = {
        type: "sessionCreated",
        chatId: 500,
        sessionId: "session-123",
        agentId: "coder",
        timestamp: Date.now(),
      };
      eventBus.emit("telegram:session", event);

      expect(handler).toHaveBeenCalledWith(event);
      expect(handler.mock.calls[0][0].type).toBe("sessionCreated");
      expect(handler.mock.calls[0][0].sessionId).toBe("session-123");
    });

    it("should emit sessionUpdated event", () => {
      const handler = vi.fn();
      eventBus.on("telegram:session", handler);

      const event: TelegramSessionEvent = {
        type: "sessionUpdated",
        chatId: 600,
        sessionId: "session-456",
        agentId: "ask",
        timestamp: Date.now(),
      };
      eventBus.emit("telegram:session", event);

      expect(handler).toHaveBeenCalledWith(event);
      expect(handler.mock.calls[0][0].type).toBe("sessionUpdated");
    });
  });

  describe("removeAllListeners", () => {
    it("should remove all listeners", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      eventBus.on("telegram:activity", handler1);
      eventBus.on("telegram:session", handler2);

      eventBus.removeAllListeners();

      const event: TelegramActivityEvent = {
        type: "messageReceived",
        chatId: 700,
        timestamp: Date.now(),
        data: {},
      };
      eventBus.emit("telegram:activity", event);

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });
});
