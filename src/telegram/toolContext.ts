import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";
import type { ToolContext } from "../agent/tools";
import type { RepoIndex } from "../agent/embeddings";
import type { MemoryStore } from "../agent/memory";
import type { SkillManager } from "../agent/skills";
import type { PermissionLevel } from "../shared/protocol";
import type { TelegramSessionManager } from "./session";
import type { GrammyContext } from "./types";

const CONFIRM_TIMEOUT_MS = 120_000;

export function createTelegramToolContext(
  bot: Bot<GrammyContext>,
  chatId: number,
  sessions: TelegramSessionManager,
  workspaceRoot: string,
  permission: PermissionLevel,
  repoIndex: RepoIndex,
  memory: MemoryStore,
  skills: SkillManager,
): ToolContext {
  return {
    workspaceRoot,
    permission,
    memory,
    skills,
    repoIndex,
    onNote: (msg: string) => {
      bot.api.sendMessage(chatId, `📝 ${msg.slice(0, 1000)}`).catch(() => {});
    },
    confirm: async (title: string, detail: string): Promise<boolean> => {
      // Auto mode: destructive operations still need confirmation
      const destructive = title === "Delete?" || title === "Run shell command?";
      if (permission === "auto" && !destructive) {
        return true;
      }
      if (permission === "readonly") {
        await bot.api.sendMessage(
          chatId,
          `⛔ *${title}* — blocked by readonly permission.\n\`${detail.slice(0, 200)}\``,
          { parse_mode: "Markdown" }
        ).catch(() => {});
        return false;
      }

      const key = `${chatId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      const keyboard = new InlineKeyboard()
        .text("✅ Allow", `confirm:${key}:yes`)
        .text("❌ Deny", `confirm:${key}:no`);

      const msg = await bot.api.sendMessage(chatId, `⚠️ *${title}*\n\`${detail.slice(0, 200)}\``, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });

      return new Promise<boolean>((resolve, reject) => {
        const timeout = setTimeout(() => {
          sessions.resolveConfirm(key, false);
          bot.api.editMessageText(chatId, msg.message_id, `⏱️ *${title}* — timed out`, {
            parse_mode: "Markdown",
          }).catch(() => {});
          reject(new Error("Confirmation timed out"));
        }, CONFIRM_TIMEOUT_MS);

        sessions.addConfirm(key, {
          chatId,
          messageId: msg.message_id,
          resolve: (value: boolean) => {
            clearTimeout(timeout);
            bot.api.editMessageText(
              chatId,
              msg.message_id,
              value ? `✅ ${title} — allowed` : `❌ ${title} — denied`,
              { parse_mode: "Markdown" },
            ).catch(() => {});
            resolve(value);
          },
          reject: (err: Error) => {
            clearTimeout(timeout);
            reject(err);
          },
          timeout,
        });
      });
    },
    previewEdit: async (_filePath: string, _original: string, _updated: string): Promise<boolean> => {
      // Skip diff preview on Telegram - just approve if permission allows
      return permission !== "readonly";
    },
    trackFileChange: (filePath: string, status: "created" | "modified" | "deleted" | "moved", _fromPath?: string) => {
      const icons: Record<string, string> = {
        created: "🟢",
        modified: "🔵",
        deleted: "🔴",
        moved: "🟡",
      };
      bot.api.sendMessage(
        chatId,
        `${icons[status] ?? "📄"} File ${status}: \`${filePath}\``,
        { parse_mode: "Markdown" }
      ).catch(() => {});
    },
  };
}
