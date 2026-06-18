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

export function sanitizeTelegramUrl(url: string): string {
  return url.replace(/\/bot\d+:[^/]+/g, "/bot<redacted>");
}

async function logTelegramFetchResponse(res: Response, url: string): Promise<void> {
  const safeUrl = sanitizeTelegramUrl(url);
  console.log(`[TelegramBot:fetch] Response: ${res.status} ${safeUrl}`);

  if (!url.includes("/getUpdates")) {
    return;
  }

  try {
    const body = await res.clone().json() as { ok?: boolean; result?: unknown[] };
    const count = Array.isArray(body.result) ? body.result.length : 0;
    console.log(`[TelegramBot:fetch] getUpdates returned ${count} update(s)`);
  } catch (err) {
    console.warn("[TelegramBot:fetch] Failed to inspect getUpdates response", err);
  }
}

export function createAbortSignalCompatibleFetch(fetchImpl: typeof fetch = globalThis.fetch) {
  return async (input: unknown, init?: any): Promise<Response> => {
    const sourceSignal = init?.signal as AbortSignalLike | undefined;
    const url = typeof input === "string" ? input : String(input);

    if (!sourceSignal || sourceSignal instanceof AbortSignal) {
      try {
        const res = await fetchImpl(input as Parameters<typeof fetch>[0], init);
        await logTelegramFetchResponse(res, url);
        return res;
      } catch (err) {
        console.error(`[TelegramBot:fetch] Direct fetch FAILED: ${sanitizeTelegramUrl(url)}`, err);
        throw err;
      }
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort(sourceSignal.reason);

    if (sourceSignal.aborted) {
      onAbort();
    } else {
      sourceSignal.addEventListener?.("abort", onAbort, { once: true });
    }

    try {
      // Mutate init.signal in place instead of spreading to preserve
      // any non-enumerable properties or prototype chain on the init object
      const origSignal = init.signal;
      init.signal = controller.signal;
      try {
        const res = await fetchImpl(input as Parameters<typeof fetch>[0], init);
        await logTelegramFetchResponse(res, url);
        return res;
      } finally {
        init.signal = origSignal;
      }
    } catch (err) {
      console.error(`[TelegramBot:fetch] Wrapped fetch FAILED: ${sanitizeTelegramUrl(url)}`, err);
      throw err;
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
  private starting = false;
  private readonly sessions = new TelegramSessionManager();
  private startedAt = 0;
  private _config: TelegramBotConfig = {
    token: "",
    allowedChatIds: [],
    workspacePath: "",
    startOnActivation: false,
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
      startOnActivation: config.get<boolean>("startOnActivation", false),
      proxyUrl: config.get<string>("proxyUrl", ""),
    };
  }

  async start(): Promise<void> {
    if (this.bot || this.starting) {
      return;
    }

    this.starting = true;

    try {
      await this.loadConfig();

      if (!this._config.token) {
        vscode.window.showWarningMessage(
          "Telegram bot token not configured. Run 'AI Agent: Set Telegram Bot Token' to set it up."
        );
        this.starting = false;
        return;
      }

      // Configure proxy before any Telegram API calls
      await configureProxy(this._config.proxyUrl);

      console.log(`[TelegramBot] Starting bot, token length=${this._config.token.length}, proxyUrl="${this._config.proxyUrl}"`);
      const bot = new Bot<GrammyContext>(this._config.token, {
        client: {
          fetch: createAbortSignalCompatibleFetch() as any,
        },
      });

      // Verify token by calling getMe() before starting polling
      console.log("[TelegramBot] Calling getMe()...");
      const me = await bot.api.getMe();
      console.log(`[TelegramBot] getMe OK: @${me.username} (${me.id})`);

      this.bot = bot;

      // Log every incoming update
      this.bot.use(async (ctx, next) => {
        console.log(`[TelegramBot] Update received: chatId=${ctx.chat?.id}, messageId=${ctx.message?.message_id}, text=${ctx.message?.text?.slice(0, 50)}`);
        await next();
      });

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
      console.log("[TelegramBot] Handlers registered. Starting long-polling...");

      // Detailed error handler — log every polling failure
      this.bot.catch((err) => {
        const msg = describeError(err);
        console.error(`[TelegramBot] Handler/polling error: ${msg}`);
        console.error("[TelegramBot] Error details:", err);
      });

      // Don't await bot.start() — it runs an infinite polling loop and never resolves.
      this.bot.start({
        onStart: ({ username }) => {
          this.startedAt = Date.now();
          this.starting = false;
          console.log(`[TelegramBot] Bot @${username} is running!`);
          console.log(`[TelegramBot] Polling started. Listening for updates...`);
          vscode.window.showInformationMessage(
            `🤖 Telegram bot @${username} is running!`
          );
        },
      }).then(() => {
        console.warn("[TelegramBot] bot.start() resolved unexpectedly — polling loop may have exited.");
        this.starting = false;
      }).catch((err: unknown) => {
        if (err instanceof Error && err.message.includes("Aborted")) {
          console.log("[TelegramBot] Polling stopped (aborted).");
          this.starting = false;
          return;
        }
        const message = describeError(err);
        console.error("[TelegramBot] start() FAILED:", message);
        console.error("[TelegramBot] Full error object:", err);
        // Stop the old bot instance before clearing to prevent 409 conflicts
        const oldBot = this.bot;
        this.bot = null;
        this.starting = false;
        if (oldBot) {
          oldBot.stop().catch(() => {});
        }
        vscode.window.showErrorMessage(`Telegram bot failed: ${message}`);
      });
    } catch (err: unknown) {
      this.bot = null;
      this.starting = false;
      const message = describeError(err);
      console.error("[TelegramBot] Startup error:", message);
      vscode.window.showErrorMessage(`Failed to start Telegram bot: ${message}`);
    }
  }

  async stop(): Promise<void> {
    if (!this.bot) {
      return;
    }
    this.starting = false;
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
