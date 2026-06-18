import { Bot, HttpError, type Context } from "grammy";
import * as vscode from "vscode";
import { TelegramSessionManager } from "./session";
import { registerHandlers } from "./handlers";
import { resolveStorageDir } from "../agent/dataPath";
import type { TelegramBotConfig, TelegramBotStatus, GrammyContext } from "./types";

function describeError(err: unknown): string {
  if (err instanceof HttpError) {
    const cause = err.error;
    if (cause instanceof Error) {
      return `${err.message} (cause: ${cause.name}: ${cause.message})`;
    }
    return err.message;
  }
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }
  return String(err);
}

type AbortSignalLike = {
  aborted?: boolean;
  reason?: unknown;
  addEventListener?: (type: "abort", listener: () => void, options?: { once?: boolean }) => void;
  removeEventListener?: (type: "abort", listener: () => void) => void;
};

export function createAbortSignalCompatibleFetch(fetchImpl: typeof fetch = globalThis.fetch) {
  return async (input: unknown, init?: any): Promise<Response> => {
    const sourceSignal = init?.signal as AbortSignalLike | undefined;

    if (!sourceSignal || sourceSignal instanceof AbortSignal) {
      return fetchImpl(input as Parameters<typeof fetch>[0], init);
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort(sourceSignal.reason);

    if (sourceSignal.aborted) {
      onAbort();
    } else {
      sourceSignal.addEventListener?.("abort", onAbort, { once: true });
    }

    try {
      return await fetchImpl(input as Parameters<typeof fetch>[0], { ...init, signal: controller.signal });
    } finally {
      sourceSignal.removeEventListener?.("abort", onAbort);
    }
  };
}

/**
 * Detect proxy from VS Code settings or environment variables and configure
 * undici's global dispatcher so that grammy's `fetch` calls go through the proxy.
 * Priority: VS Code setting > HTTPS_PROXY env var.
 */
async function configureProxy(settingsProxyUrl: string): Promise<void> {
  console.log(`[TelegramBot] configureProxy called, settingsProxyUrl="${settingsProxyUrl}"`);
  const proxyUrl = settingsProxyUrl
    || process.env.HTTPS_PROXY
    || process.env.https_proxy
    || process.env.HTTP_PROXY
    || process.env.http_proxy
    || process.env.ALL_PROXY
    || process.env.all_proxy;
  if (!proxyUrl) {
    console.log("[TelegramBot] No proxy configured. Connecting directly.");
    return;
  }
  try {
    const undici = await import("undici");
    console.log("[TelegramBot] undici loaded, keys:", Object.keys(undici).filter(k => k.includes("Proxy") || k.includes("proxy") || k.includes("Global")));
    undici.setGlobalDispatcher(new undici.ProxyAgent(proxyUrl));
    console.log(`[TelegramBot] Proxy configured: ${proxyUrl}`);
  } catch (err) {
    console.error("[TelegramBot] Failed to configure proxy:", err);
  }
}

export class TelegramBotManager implements vscode.Disposable {
  private bot: Bot<GrammyContext> | null = null;
  private readonly sessions = new TelegramSessionManager();
  private startedAt = 0;
  private _config: TelegramBotConfig = {
    token: "",
    allowedChatIds: [],
    workspacePath: "",
    startOnActivation: true,
    proxyUrl: "",
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
      startOnActivation: this._config.startOnActivation,
      proxyUrl: this._config.proxyUrl,
    };
  }

  async loadConfig(): Promise<void> {
    const config = vscode.workspace.getConfiguration("aiAgentChat.telegram");
    this._config = {
      token: await this.context.secrets.get("aiAgentChat.telegram.token") ?? "",
      allowedChatIds: config.get<number[]>("allowedChatIds", []),
      workspacePath: config.get<string>("workspacePath", ""),
      startOnActivation: config.get<boolean>("startOnActivation", true),
      proxyUrl: config.get<string>("proxyUrl", ""),
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

    // Configure proxy before any Telegram API calls
    await configureProxy(this._config.proxyUrl);

    try {
      console.log(`[TelegramBot] Starting bot, token length=${this._config.token.length}, proxyUrl="${this._config.proxyUrl}"`);
      const bot = new Bot<GrammyContext>(this._config.token, {
        client: {
          // grammY creates abort-controller signals, while VS Code's extension
          // host fetch expects its own native AbortSignal instances.
          fetch: createAbortSignalCompatibleFetch() as any,
        },
      });

      // Verify token by calling getMe() before starting polling
      console.log("[TelegramBot] Calling getMe()...");
      const me = await bot.api.getMe();
      console.log(`[TelegramBot] getMe OK: @${me.username} (${me.id})`);

      this.bot = bot;

      // Auth middleware - check allowed chat IDs dynamically
      this.bot.use(async (ctx, next) => {
        const ids = this._config.allowedChatIds;
        if (ids.length > 0) {
          const chatId = ctx.chat?.id;
          if (chatId && !ids.includes(chatId)) {
            await ctx.reply("⛔ You are not authorized to use this bot.");
            return;
          }
        }
        await next();
      });

      const storageUri = resolveStorageDir(this.context);
      registerHandlers(this.bot, this.sessions, this.context.secrets, storageUri, () => this._config.workspacePath);

      // Simple error handler
      this.bot.catch((err) => {
        console.error("[TelegramBot] Polling error:", describeError(err));
      });

      // Don't await bot.start() — it runs an infinite polling loop and never resolves.
      this.bot.start({
        onStart: ({ username }) => {
          this.startedAt = Date.now();
          console.log(`[TelegramBot] Bot @${username} is running!`);
          vscode.window.showInformationMessage(
            `🤖 Telegram bot @${username} is running!`
          );
        },
      }).catch((err: unknown) => {
        // "Aborted" is expected when bot.stop() is called — ignore it
        if (err instanceof Error && err.message.includes("Aborted")) {
          return;
        }
        const message = describeError(err);
        console.error("[TelegramBot] start() failed:", message);
        vscode.window.showErrorMessage(`Telegram bot failed: ${message}`);
        this.bot = null;
      });
    } catch (err: unknown) {
      this.bot = null;
      const message = describeError(err);
      console.error("[TelegramBot] Startup error:", message);
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
