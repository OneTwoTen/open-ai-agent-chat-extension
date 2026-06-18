import { type AgentCallbacks } from "../agent/agent";
import type { UsageStats } from "../shared/protocol";
import type { GrammyContext } from "./types";
import { Api, type Bot } from "grammy";

const MAX_TG_LENGTH = 4000;
const TYPING_INTERVAL_MS = 4000;

function splitMessage(text: string): string[] {
  if (text.length <= MAX_TG_LENGTH) {
    return [text];
  }
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    // Try to split at a newline within the limit
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
    // Fallback: try without markdown
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
    // Fallback: try without markdown
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
  let usageReported = false;
  let finalUsage: UsageStats | null = null;

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

  return {
    onTextDelta(text: string): void {
      startTyping();
      const current = getStreamingText();
      const updated = current + text;
      setStreamingText(updated);

      // Truncate extremely long messages
      const displayText = updated.length > MAX_TG_LENGTH * 4
        ? updated.slice(0, MAX_TG_LENGTH * 4) + "\n\n*(message too long, truncated)*"
        : updated;

      const mid = getStreamingMessageId();
      if (mid) {
        if (displayText.length <= MAX_TG_LENGTH) {
          editSafe(bot, chatId, mid, displayText, "Markdown");
        } else {
          // Message too long for edit - send as multiple messages
          stopTyping();

          // Send accumulated text as separate messages
          const parts = splitMessage(current);
          for (const p of parts) {
            sendSafe(bot, chatId, p, "Markdown");
          }
          setStreamingText(text);
          setStreamingMessageId(null);
        }
      }

      // Start a new streaming message
      if (!getStreamingMessageId()) {
        sendSafe(bot, chatId, displayText.slice(0, MAX_TG_LENGTH) || "...", "Markdown")
          .then((id) => {
            if (id) setStreamingMessageId(id);
          });
      }
    },

    onReasoningDelta(_text: string): void {
      // Silently skip reasoning traces on Telegram
    },

    onToolCall(id: string, name: string, _args: unknown): void {
      startTyping();
      // Send a concise tool notification
      bot.api.sendMessage(chatId, `🔧 \`${name}\``, { parse_mode: "Markdown" })
        .catch(() => {});
    },

    onToolResult(_id: string, name: string, _result: unknown): void {
      startTyping();
    },

    onStepUsage(_tools: string[], _usage: UsageStats): void {
      // No per-step usage on Telegram
    },

    onFinalUsage(usage: UsageStats): void {
      finalUsage = usage;
      usageReported = true;
      if (onUsage) onUsage(usage);
    },

    onError(message: string): void {
      stopTyping();
      const mid = getStreamingMessageId();
      const errorText = `❌ *Error:* ${escapeMarkdown(message.slice(0, 1000))}`;
      if (mid) {
        editSafe(bot, chatId, mid, errorText, "Markdown");
      } else {
        sendSafe(bot, chatId, errorText, "Markdown");
      }
    },

    onDone(): void {
      stopTyping();

      // Send usage summary if available
      if (finalUsage) {
        const usageLine =
          `📊 *Usage:* ${finalUsage.inputTokens} in · ${finalUsage.outputTokens} out · ${finalUsage.totalTokens} total`
          + (finalUsage.cachedInputTokens ? ` (${finalUsage.cachedInputTokens} cached)` : "");
        sendSafe(bot, chatId, usageLine, "Markdown");
      }
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
