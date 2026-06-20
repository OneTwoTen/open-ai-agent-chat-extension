import { describe, it, expect, vi } from "vitest";
import type { Attachment, TranscriptItem } from "../src/shared/protocol";

vi.mock("../webview-ui/vscodeApi", () => ({
  vscode: { postMessage: vi.fn(), getState: vi.fn(), setState: vi.fn() },
  onHostMessage: vi.fn(() => vi.fn()),
}));

import {
  appendToAssistant,
  closeAssistant,
  transcriptToChat,
  mergeAttachments,
} from "../webview-ui/controller";
import type { ChatItem } from "../webview-ui/controller";

function makeAssistant(overrides: Partial<ChatItem & { kind: "assistant" }> = {}): ChatItem {
  return {
    kind: "assistant",
    text: "",
    reasoning: "",
    open: true,
    ...overrides,
  } as ChatItem;
}

function makeUser(text = "hello"): ChatItem {
  return { kind: "user", text, attachments: undefined };
}

function makeError(text = "error"): ChatItem {
  return { kind: "error", text };
}

describe("appendToAssistant", () => {
  it("appends text delta to the last assistant message when open", () => {
    const items: ChatItem[] = [makeUser("hi"), makeAssistant({ text: "Hel" })];
    const result = appendToAssistant(items, "text", "lo", "model-x");
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ kind: "assistant", text: "Hello", open: true });
  });

  it("appends reasoning delta to the last assistant message when open", () => {
    const items: ChatItem[] = [makeAssistant({ reasoning: "Step 1" })];
    const result = appendToAssistant(items, "reasoning", " Step 2", "");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "assistant", reasoning: "Step 1 Step 2" });
  });

  it("creates a new assistant message when last item is not assistant", () => {
    const items: ChatItem[] = [makeUser("hi")];
    const result = appendToAssistant(items, "text", "Hello", "gpt-4o");
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      kind: "assistant",
      text: "Hello",
      reasoning: "",
      open: true,
      model: "gpt-4o",
    });
  });

  it("creates a new assistant message when last assistant is closed", () => {
    const items: ChatItem[] = [makeAssistant({ open: false, text: "Done" })];
    const result = appendToAssistant(items, "text", "New", "");
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ kind: "assistant", text: "New", open: true });
  });

  it("creates a new assistant when last item is error", () => {
    const items: ChatItem[] = [makeError("fail")];
    const result = appendToAssistant(items, "text", "Hello", "");
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ kind: "assistant", text: "Hello", open: true });
  });

  it("sets model to undefined when model string is empty", () => {
    const items: ChatItem[] = [makeUser("hi")];
    const result = appendToAssistant(items, "text", "Hello", "");
    expect(result[1]).toMatchObject({ model: undefined });
  });

  it("sets model when provided", () => {
    const items: ChatItem[] = [makeUser("hi")];
    const result = appendToAssistant(items, "text", "Hello", "claude-3");
    expect(result[1]).toMatchObject({ model: "claude-3" });
  });
});

describe("closeAssistant", () => {
  it("closes the last open assistant message", () => {
    const items: ChatItem[] = [makeUser("hi"), makeAssistant({ text: "Hello" })];
    const result = closeAssistant(items);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ kind: "assistant", text: "Hello", open: false });
  });

  it("does nothing when last item is not assistant", () => {
    const items: ChatItem[] = [makeUser("hi")];
    const result = closeAssistant(items);
    expect(result).toBe(items);
  });

  it("does nothing when last assistant is already closed", () => {
    const items: ChatItem[] = [makeAssistant({ open: false })];
    const result = closeAssistant(items);
    expect(result).toBe(items);
  });

  it("does nothing when items are empty", () => {
    const items: ChatItem[] = [];
    const result = closeAssistant(items);
    expect(result).toBe(items);
  });
});

describe("transcriptToChat", () => {
  it("converts user transcript item", () => {
    const t: TranscriptItem = { kind: "user", text: "hello", attachments: ["a.ts"] };
    const result = transcriptToChat(t);
    expect(result).toEqual({ kind: "user", text: "hello", attachments: ["a.ts"] });
  });

  it("converts assistant transcript item", () => {
    const t: TranscriptItem = { kind: "assistant", text: "response", model: "gpt-4o" };
    const result = transcriptToChat(t);
    expect(result).toEqual({
      kind: "assistant",
      text: "response",
      reasoning: "",
      open: false,
      model: "gpt-4o",
    });
  });

  it("converts tool transcript item", () => {
    const t: TranscriptItem = {
      kind: "tool",
      id: "t1",
      name: "read_file",
      args: { path: "x.ts" },
      result: "content",
    };
    const result = transcriptToChat(t);
    expect(result).toEqual({
      kind: "tool",
      id: "t1",
      name: "read_file",
      args: { path: "x.ts" },
      result: "content",
      status: "done",
    });
  });

  it("converts error transcript item", () => {
    const t: TranscriptItem = { kind: "error", text: "something broke" };
    const result = transcriptToChat(t);
    expect(result).toEqual({ kind: "error", text: "something broke" });
  });
});

describe("mergeAttachments", () => {
  it("merges two lists, deduplicating by path", () => {
    const prev: Attachment[] = [
      { path: "/a/1.ts", content: "old" },
      { path: "/a/2.ts", content: "keep" },
    ];
    const next: Attachment[] = [
      { path: "/a/1.ts", content: "new" },
      { path: "/a/3.ts", content: "added" },
    ];
    const result = mergeAttachments(prev, next);
    expect(result).toHaveLength(3);
    expect(result.find((a) => a.path === "/a/1.ts")?.content).toBe("new");
    expect(result.find((a) => a.path === "/a/2.ts")?.content).toBe("keep");
    expect(result.find((a) => a.path === "/a/3.ts")?.content).toBe("added");
  });

  it("returns next items when prev is empty", () => {
    const next: Attachment[] = [{ path: "/a.ts", content: "hi" }];
    expect(mergeAttachments([], next)).toEqual(next);
  });

  it("returns prev items when next is empty", () => {
    const prev: Attachment[] = [{ path: "/a.ts", content: "hi" }];
    expect(mergeAttachments(prev, [])).toEqual(prev);
  });

  it("preserves order: prev first, then new from next", () => {
    const prev: Attachment[] = [{ path: "/a.ts", content: "a" }];
    const next: Attachment[] = [{ path: "/b.ts", content: "b" }];
    const result = mergeAttachments(prev, next);
    expect(result[0].path).toBe("/a.ts");
    expect(result[1].path).toBe("/b.ts");
  });

  it("handles both empty lists", () => {
    expect(mergeAttachments([], [])).toEqual([]);
  });
});
