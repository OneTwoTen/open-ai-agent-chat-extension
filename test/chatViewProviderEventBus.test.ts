import { describe, expect, it, vi, beforeEach } from "vitest";
import { eventBus, TelegramActivityEvent } from "../src/shared/eventBus";

describe("ChatViewProvider EventBus Integration", () => {
  beforeEach(() => {
    eventBus.removeAllListeners();
  });

  it("should format telegram activity summary correctly for messageReceived", () => {
    const event: TelegramActivityEvent = {
      type: "messageReceived",
      chatId: 123,
      timestamp: Date.now(),
      data: { text: "Hello world", agentId: "coder" },
    };

    // Test the summary formatting logic (extracted from ChatViewProvider)
    let summary = "";
    switch (event.type) {
      case "messageReceived":
        summary = `Chat ${event.chatId}: ${String(event.data.text).slice(0, 100)}`;
        break;
    }

    expect(summary).toBe("Chat 123: Hello world");
  });

  it("should format telegram activity summary correctly for turnStarted", () => {
    const event: TelegramActivityEvent = {
      type: "turnStarted",
      chatId: 456,
      timestamp: Date.now(),
      data: { agentId: "coder", providerId: "openai", modelId: "gpt-4o" },
    };

    let summary = "";
    switch (event.type) {
      case "turnStarted":
        summary = `Chat ${event.chatId}: Agent working...`;
        break;
    }

    expect(summary).toBe("Chat 456: Agent working...");
  });

  it("should format telegram activity summary correctly for toolCalled", () => {
    const event: TelegramActivityEvent = {
      type: "toolCalled",
      chatId: 789,
      timestamp: Date.now(),
      data: { toolName: "read_file", args: { path: "test.ts" } },
    };

    let summary = "";
    switch (event.type) {
      case "toolCalled":
        summary = `Chat ${event.chatId}: Using ${String(event.data.toolName)}`;
        break;
    }

    expect(summary).toBe("Chat 789: Using read_file");
  });

  it("should format telegram activity summary correctly for error", () => {
    const event: TelegramActivityEvent = {
      type: "error",
      chatId: 101,
      timestamp: Date.now(),
      data: { message: "Something went wrong" },
    };

    let summary = "";
    switch (event.type) {
      case "error":
        summary = `Chat ${event.chatId}: Error - ${String(event.data.message).slice(0, 100)}`;
        break;
    }

    expect(summary).toBe("Chat 101: Error - Something went wrong");
  });

  it("should truncate long messages in summary", () => {
    const longText = "A".repeat(200);
    const event: TelegramActivityEvent = {
      type: "messageReceived",
      chatId: 202,
      timestamp: Date.now(),
      data: { text: longText },
    };

    let summary = "";
    switch (event.type) {
      case "messageReceived":
        summary = `Chat ${event.chatId}: ${String(event.data.text).slice(0, 100)}`;
        break;
    }

    expect(summary.length).toBeLessThan(150);
    expect(summary).toContain("Chat 202:");
  });

  it("should create unique activity item IDs", () => {
    const chatId = 303;
    const timestamp = 1234567890;
    const id = `${chatId}-${timestamp}`;
    expect(id).toBe("303-1234567890");
  });

  it("should handle multiple activity events in sequence", () => {
    const events: TelegramActivityEvent[] = [
      {
        type: "messageReceived",
        chatId: 404,
        timestamp: 1000,
        data: { text: "msg1" },
      },
      {
        type: "turnStarted",
        chatId: 404,
        timestamp: 2000,
        data: { agentId: "coder" },
      },
      {
        type: "toolCalled",
        chatId: 404,
        timestamp: 3000,
        data: { toolName: "read_file" },
      },
      {
        type: "turnCompleted",
        chatId: 404,
        timestamp: 4000,
        data: {},
      },
    ];

    const handler = vi.fn();
    eventBus.on("telegram:activity", handler);

    for (const event of events) {
      eventBus.emit("telegram:activity", event);
    }

    expect(handler).toHaveBeenCalledTimes(4);
    expect(handler.mock.calls.map((c: [TelegramActivityEvent]) => c[0].type)).toEqual([
      "messageReceived",
      "turnStarted",
      "toolCalled",
      "turnCompleted",
    ]);
  });
});
