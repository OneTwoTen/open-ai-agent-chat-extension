import { describe, expect, it, vi, beforeEach } from "vitest";
import { createTelegramCallbacks } from "../src/telegram/callbacks";
import { eventBus, TelegramActivityEvent } from "../src/shared/eventBus";

function createBotMock() {
  let nextMessageId = 1;
  return {
    api: {
      sendChatAction: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => ({ message_id: nextMessageId++ })),
      editMessageText: vi.fn(async () => true),
    },
  };
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createTelegramCallbacks with EventBus integration", () => {
  beforeEach(() => {
    eventBus.removeAllListeners();
  });

  it("should emit telegram:activity event when onToolCall is invoked", async () => {
    const bot = createBotMock();
    let messageId: number | null = null;
    let text = "";
    const callbacks = createTelegramCallbacks(
      bot as any,
      123,
      () => messageId,
      (id) => { messageId = id; },
      () => text,
      (value) => { text = value; },
    );

    const activityHandler = vi.fn();
    eventBus.on("telegram:activity", activityHandler);

    callbacks.onToolCall("tool-1", "read_file", { path: "test.ts" });
    await flushPromises();

    expect(activityHandler).toHaveBeenCalledTimes(1);
    const event: TelegramActivityEvent = activityHandler.mock.calls[0][0];
    expect(event.type).toBe("toolCalled");
    expect(event.chatId).toBe(123);
    expect(event.data.toolName).toBe("read_file");
    expect(event.data.args).toEqual({ path: "test.ts" });
  });

  it("should emit telegram:activity event when onToolResult is invoked", async () => {
    const bot = createBotMock();
    let messageId: number | null = null;
    let text = "";
    const callbacks = createTelegramCallbacks(
      bot as any,
      456,
      () => messageId,
      (id) => { messageId = id; },
      () => text,
      (value) => { text = value; },
    );

    const activityHandler = vi.fn();
    eventBus.on("telegram:activity", activityHandler);

    callbacks.onToolResult("tool-1", "write_file", "File written successfully");
    await flushPromises();

    expect(activityHandler).toHaveBeenCalledTimes(1);
    const event: TelegramActivityEvent = activityHandler.mock.calls[0][0];
    expect(event.type).toBe("toolResult");
    expect(event.chatId).toBe(456);
    expect(event.data.toolName).toBe("write_file");
    expect(event.data.resultLength).toBe(25);
  });

  it("should emit events for multiple tool calls", async () => {
    const bot = createBotMock();
    let messageId: number | null = null;
    let text = "";
    const callbacks = createTelegramCallbacks(
      bot as any,
      789,
      () => messageId,
      (id) => { messageId = id; },
      () => text,
      (value) => { text = value; },
    );

    const activityHandler = vi.fn();
    eventBus.on("telegram:activity", activityHandler);

    callbacks.onToolCall("tool-1", "read_file", { path: "a.ts" });
    callbacks.onToolCall("tool-2", "edit_file", { path: "b.ts" });
    callbacks.onToolCall("tool-3", "run_command", { cmd: "npm test" });
    await flushPromises();

    expect(activityHandler).toHaveBeenCalledTimes(3);
    expect(activityHandler.mock.calls[0][0].data.toolName).toBe("read_file");
    expect(activityHandler.mock.calls[1][0].data.toolName).toBe("edit_file");
    expect(activityHandler.mock.calls[2][0].data.toolName).toBe("run_command");
  });

  it("should emit events with correct timestamps", async () => {
    const bot = createBotMock();
    let messageId: number | null = null;
    let text = "";
    const callbacks = createTelegramCallbacks(
      bot as any,
      111,
      () => messageId,
      (id) => { messageId = id; },
      () => text,
      (value) => { text = value; },
    );

    const activityHandler = vi.fn();
    eventBus.on("telegram:activity", activityHandler);

    const before = Date.now();
    callbacks.onToolCall("tool-1", "search_text", { query: "test" });
    const after = Date.now();

    expect(activityHandler).toHaveBeenCalledTimes(1);
    const event: TelegramActivityEvent = activityHandler.mock.calls[0][0];
    expect(event.timestamp).toBeGreaterThanOrEqual(before);
    expect(event.timestamp).toBeLessThanOrEqual(after);
  });

  it("should not emit events when callbacks are used without eventBus listeners", async () => {
    const bot = createBotMock();
    let messageId: number | null = null;
    let text = "";
    const callbacks = createTelegramCallbacks(
      bot as any,
      222,
      () => messageId,
      (id) => { messageId = id; },
      () => text,
      (value) => { text = value; },
    );

    // No eventBus listeners registered
    callbacks.onToolCall("tool-1", "read_file", { path: "test.ts" });
    await flushPromises();

    // Should not throw
    expect(bot.api.sendMessage).toHaveBeenCalled();
  });

  it("should handle errors in eventBus handlers gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bot = createBotMock();
    let messageId: number | null = null;
    let text = "";
    const callbacks = createTelegramCallbacks(
      bot as any,
      333,
      () => messageId,
      (id) => { messageId = id; },
      () => text,
      (value) => { text = value; },
    );

    const badHandler = () => {
      throw new Error("Handler error");
    };
    const goodHandler = vi.fn();

    eventBus.on("telegram:activity", badHandler);
    eventBus.on("telegram:activity", goodHandler);

    callbacks.onToolCall("tool-1", "read_file", { path: "test.ts" });
    await flushPromises();

    // Good handler should still be called
    expect(goodHandler).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
