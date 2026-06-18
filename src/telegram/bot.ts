import { Bot, type Context } from "grammy";
import * as vscode from "vscode";
import { TelegramSessionManager } from "./session";
import { registerHandlers } from "./handlers";
import type { TelegramBotConfig, TelegramBotStatus, GrammyContext } from "./types";

export class TelegramBotManager implements vscode.Disposable {
  private bot: Bot<GrammyContext> | null = null;
  private readonly sessions = new TelegramSessionManager();
  private startedAt = 0;
  private _config: TelegramBotConfig = {
    token: "",
    allowedChatIds: [],
    workspacePath: "",
    startOnActivation: true,
  };

  constructor(private readonly context: vscode.ExtensionContext) {}

  get config(): TelegramBotConfig {
    return { ...this._config };
  }

  get isRunning(): boolean {
    return this.bot !== null;
  }

  get status(): TelegramBotStatus {
    return {
      running: this.isRunning,
      chatCount: this.sessions.chatCount(),
      uptime: this.startedAt ? Date.now() - this.startedAt : 0,
      allowedChatIds: this._config.allowedChatIds,
      workspacePath: this._config.workspacePath,
    };
  }

  async loadConfig(): Promise<void> {
    const config = vscode.workspace.getConfiguration("aiAgentChat.telegram");
    this._config = {
      token: await this.context.secrets.get("aiAgentChat.telegram.token") ?? "",
      allowedChatIds: config.get<number[]>("allowedChatIds", []),
      workspacePath: config.get<string>("workspacePath", ""),
      startOnActivation: config.get<boolean>("startOnActivation", true),
    };
  }

  async start(): Promise<void> {
    if (this.bot) {
      return;
    }

    await this.loadConfig();

    if (!this._config.token) {
      vscode.window.showWarningMessage(
        "Telegram bot token not configured. Run 'AI Agent: Set Telegram Bot Token' to set it up."
      );
      return;
    }

    try {
      this.bot = new Bot<GrammyContext>(this._config.token);

      // Auth middleware - check allowed chat IDs
      if (this._config.allowedChatIds.length > 0) {
        this.bot.use(async (ctx, next) => {
          const chatId = ctx.chat?.id;
          if (chatId && !this._config.allowedChatIds.includes(chatId)) {
            await ctx.reply("⛔ You are not authorized to use this bot.");
            return;
          }
          await next();
        });
      }

      const storageUri = this.context.storageUri ?? this.context.globalStorageUri;
      registerHandlers(this.bot, this.sessions, this.context.secrets, storageUri, () => this._config.workspacePath);

      // Simple error handler
      this.bot.catch((err) => {
        console.error("Telegram bot error:", err);
      });

      await this.bot.start({
        onStart: ({ username }) => {
          this.startedAt = Date.now();
          vscode.window.showInformationMessage(
            `🤖 Telegram bot @${username} is running!`
          );
        },
      });
    } catch (err: unknown) {
      this.bot = null;
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to start Telegram bot: ${message}`);
    }
  }

  async stop(): Promise<void> {
    if (!this.bot) {
      return;
    }
    try {
      await this.bot.stop();
    } catch {
      // Ignore stop errors
    }
    this.bot = null;
    this.sessions.dispose();
    this.startedAt = 0;
    vscode.window.showInformationMessage("Telegram bot stopped.");
  }

  /** Called by extension.ts activate() — conditionally starts if configured. */
  async tryAutoStart(): Promise<void> {
    await this.loadConfig();
    if (this._config.startOnActivation && this._config.token) {
      await this.start();
    }
  }

  dispose(): void {
    if (this.bot) {
      this.bot.stop().catch(() => {});
      this.bot = null;
    }
    this.sessions.dispose();
  }
}
