import { describe, expect, it, vi } from "vitest";
import { createAbortSignalCompatibleFetch, sanitizeTelegramUrl, TelegramBotManager } from "../src/telegram/bot";

class ForeignAbortSignal extends EventTarget {
  aborted = false;
  reason: unknown;

  abort(reason?: unknown): void {
    this.aborted = true;
    this.reason = reason;
    this.dispatchEvent(new Event("abort"));
  }
}

describe("createAbortSignalCompatibleFetch", () => {
  it("redacts bot tokens from logged Telegram URLs", () => {
    const url = "https://api.telegram.org/bot123456:SECRET_TOKEN/getUpdates";

    expect(sanitizeTelegramUrl(url)).toBe("https://api.telegram.org/bot<redacted>/getUpdates");
  });

  it("logs getUpdates result counts without consuming the response body", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: [{ update_id: 1 }] })));
    const fetch = createAbortSignalCompatibleFetch(fetchImpl as typeof globalThis.fetch);

    const res = await fetch("https://api.telegram.org/bot123456:SECRET_TOKEN/getUpdates");

    expect(await res.json()).toEqual({ ok: true, result: [{ update_id: 1 }] });
    expect(log).toHaveBeenCalledWith("[TelegramBot:fetch] Response: 200 https://api.telegram.org/bot<redacted>/getUpdates");
    expect(log).toHaveBeenCalledWith("[TelegramBot:fetch] getUpdates returned 1 update(s)");
    log.mockRestore();
  });

  it("bridges non-native abort signals before calling fetch", async () => {
    const foreignSignal = new ForeignAbortSignal();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.signal).not.toBe(foreignSignal);
      return new Response(JSON.stringify({ ok: true }));
    });

    const fetch = createAbortSignalCompatibleFetch(fetchImpl as typeof globalThis.fetch);
    await fetch("https://api.telegram.org/botTOKEN/getMe", { signal: foreignSignal as unknown as AbortSignal });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("forwards aborts from non-native signals", async () => {
    const foreignSignal = new ForeignAbortSignal();
    let bridgedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bridgedSignal = init?.signal;
      foreignSignal.abort("stop");
      return new Response(JSON.stringify({ ok: true }));
    });

    const fetch = createAbortSignalCompatibleFetch(fetchImpl as typeof globalThis.fetch);
    await fetch("https://api.telegram.org/botTOKEN/getMe", { signal: foreignSignal as unknown as AbortSignal });

    expect(bridgedSignal?.aborted).toBe(true);
    expect(bridgedSignal?.reason).toBe("stop");
  });
});

describe("TelegramBotManager", () => {
  it("does not auto-start by default", async () => {
    const context = {
      secrets: {
        get: vi.fn(async () => undefined),
      },
    } as any;
    const manager = new TelegramBotManager(context);

    await manager.loadConfig();

    expect(manager.config.startOnActivation).toBe(false);
  });
});
