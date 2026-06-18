import { describe, expect, it, vi } from "vitest";
import { createAbortSignalCompatibleFetch } from "../src/telegram/bot";

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
