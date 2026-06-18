import { describe, expect, it, vi } from "vitest";
import { createTelegramCallbacks } from "../src/telegram/callbacks";

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

describe("createTelegramCallbacks", () => {
  it("coalesces rapid text deltas into a single Telegram message", async () => {
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

    callbacks.onTextDelta("Dựa trên ");
    callbacks.onTextDelta("cấu trúc project");
    await flushPromises();

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(bot.api.editMessageText).toHaveBeenCalled();
  });

  it("updates the streaming message for tool calls instead of sending tool bubbles", async () => {
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

    callbacks.onToolCall("1", "list_directory", {});
    callbacks.onToolCall("2", "read_file", {});
    await flushPromises();

    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(bot.api.editMessageText).toHaveBeenCalled();
    expect(bot.api.sendMessage.mock.calls[0][1]).toContain("list_directory");
  });
});
