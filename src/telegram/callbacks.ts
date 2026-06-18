import { type AgentCallbacks } from "../agent/agent";
import type { UsageStats } from "../shared/protocol";
import type { GrammyContext } from "./types";
import { type Bot } from "grammy";

const MAX_TG_LENGTH = 4000;
const STREAM_EDIT_LIMIT = 3800;
const TYPING_INTERVAL_MS = 4000;

function splitMessage(text: string): string[] {
  if (text.length <= MAX_TG_LENGTH) {
    return [text];
  }
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    let splitAt = MAX_TG_LENGTH;
    if (remaining.length > MAX_TG_LENGTH) {
      const newlineIdx = remaining.lastIndexOf("\n", MAX_TG_LENGTH);
      if (newlineIdx > MAX_TG_LENGTH / 2) {
        splitAt = newlineIdx + 1;
      }
    }
    parts.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return parts;
}

async function sendSafe(
  bot: Bot<GrammyContext>,
  chatId: number,
  text: string,
  parseMode: "Markdown" | undefined,
): Promise<number | null> {
  if (!text.trim()) return null;
  try {
    const msg = await bot.api.sendMessage(chatId, text, {
      ...(parseMode ? { parse_mode: parseMode } : {}),
    });
    return msg.message_id;
  } catch {
    try {
      const msg = await bot.api.sendMessage(chatId, text);
      return msg.message_id;
    } catch {
      return null;
    }
  }
}

async function editSafe(
  bot: Bot<GrammyContext>,
  chatId: number,
  messageId: number,
  text: string,
  parseMode: "Markdown" | undefined,
): Promise<boolean> {
  try {
    await bot.api.editMessageText(chatId, messageId, text, {
      ...(parseMode ? { parse_mode: parseMode } : {}),
    });
    return true;
  } catch {
    try {
      await bot.api.editMessageText(chatId, messageId, text);
      return true;
    } catch {
      return false;
    }
  }
}

export function createTelegramCallbacks(
  bot: Bot<GrammyContext>,
  chatId: number,
  getStreamingMessageId: () => number | null,
  setStreamingMessageId: (id: number | null) => void,
  getStreamingText: () => string,
  setStreamingText: (text: string) => void,
  onUsage?: (usage: UsageStats) => void,
): AgentCallbacks {
  let typingInterval: ReturnType<typeof setInterval> | null = null;
  let messagePromise: Promise<number | null> | null = null;
  let editChain: Promise<void> = Promise.resolve();
  let lastRenderedText = "";
  const toolNames: string[] = [];

  const startTyping = () => {
    stopTyping();
    bot.api.sendChatAction(chatId, "typing").catch(() => {});
    typingInterval = setInterval(() => {
      bot.api.sendChatAction(chatId, "typing").catch(() => {});
    }, TYPING_INTERVAL_MS);
  };

  const stopTyping = () => {
    if (typingInterval) {
      clearInterval(typingInterval);
      typingInterval = null;
    }
  };

  const renderWorkingText = (): string => {
    const text = getStreamingText();
    if (text.trim()) {
      return text;
    }
    if (toolNames.length > 0) {
      return `Working...\nTools: ${toolNames.map((name) => `\`${name}\``).join(" -> ")}`;
    }
    return "Working...";
  };

  const trimForEdit = (text: string): string => {
    if (text.length <= MAX_TG_LENGTH) {
      return text;
    }
    return text.slice(0, STREAM_EDIT_LIMIT) + "\n\n...(answer is still streaming; full text will be split when done)";
  };

  const ensureStreamingMessage = (initialText: string): Promise<number | null> => {
    const mid = getStreamingMessageId();
    if (mid) {
      return Promise.resolve(mid);
    }
    if (messagePromise) {
      return messagePromise;
    }

    const text = trimForEdit(initialText);
    lastRenderedText = text;
    messagePromise = sendSafe(bot, chatId, text || "Working...", "Markdown")
      .then((id) => {
        if (id) {
          setStreamingMessageId(id);
        }
        return id;
      })
      .finally(() => {
        messagePromise = null;
      });
    return messagePromise;
  };

  const updateStreamingMessage = (text: string): void => {
    const displayText = trimForEdit(text);
    editChain = editChain
      .then(async () => {
        const id = await ensureStreamingMessage(displayText);
        if (!id || displayText === lastRenderedText) {
          return;
        }
        lastRenderedText = displayText;
        await editSafe(bot, chatId, id, displayText, "Markdown");
      })
      .catch(() => {});
  };

  const finalizeLongMessage = (): void => {
    const text = getStreamingText();
    if (text.length <= MAX_TG_LENGTH) {
      return;
    }
    editChain = editChain
      .then(async () => {
        const id = await ensureStreamingMessage(text);
        if (!id) {
          return;
        }
        const parts = splitMessage(text);
        const first = parts.shift();
        if (first && first !== lastRenderedText) {
          lastRenderedText = first;
          await editSafe(bot, chatId, id, first, "Markdown");
        }
        for (const part of parts) {
          await sendSafe(bot, chatId, part, "Markdown");
        }
      })
      .catch(() => {});
  };

  return {
    onTextDelta(text: string): void {
      startTyping();
      const updated = getStreamingText() + text;
      setStreamingText(updated);
      updateStreamingMessage(updated);
    },

    onReasoningDelta(_text: string): void {
      // Telegram only shows assistant-facing content.
    },

    onToolCall(_id: string, name: string, _args: unknown): void {
      startTyping();
      toolNames.push(name);
      updateStreamingMessage(renderWorkingText());
    },

    onToolResult(_id: string, _name: string, _result: unknown): void {
      startTyping();
    },

    onStepUsage(_tools: string[], _usage: UsageStats): void {
      // No per-step usage on Telegram.
    },

    onFinalUsage(usage: UsageStats): void {
      if (onUsage) onUsage(usage);
    },

    onError(message: string): void {
      stopTyping();
      const errorText = `Error: ${escapeMarkdown(message.slice(0, 1000))}`;
      editChain = editChain
        .then(async () => {
          const id = await ensureStreamingMessage(errorText);
          if (id) {
            await editSafe(bot, chatId, id, errorText, "Markdown");
          }
        })
        .catch(() => {});
    },

    onDone(): void {
      stopTyping();
      finalizeLongMessage();
    },
  };
}

function escapeMarkdown(text: string): string {
  return text
    .replace(/_/g, "\\_")
    .replace(/\*/g, "\\*")
    .replace(/\[/g, "\\[")
    .replace(/`/g, "\\`");
}
