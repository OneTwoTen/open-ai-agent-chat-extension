import { describe, expect, it } from "vitest";
import { parseConfirmCallbackData, runInBackground } from "../src/telegram/handlers";

describe("parseConfirmCallbackData", () => {
  it("parses command confirmation callback data", () => {
    expect(parseConfirmCallbackData("confirm:123:456:abc:yes")).toEqual({
      key: "123:456:abc",
      chatId: 123,
      value: true,
    });
  });

  it("keeps the full key for preview confirmations", () => {
    expect(parseConfirmCallbackData("confirm:-100:preview:456:abc:no")).toEqual({
      key: "-100:preview:456:abc",
      chatId: -100,
      value: false,
    });
  });

  it("rejects invalid callback data", () => {
    expect(parseConfirmCallbackData("confirm:123:456:maybe")).toBeNull();
    expect(parseConfirmCallbackData("other:123:456:yes")).toBeNull();
  });
});

describe("runInBackground", () => {
  it("starts async work without returning a promise", async () => {
    let completed = false;

    const result = runInBackground("test turn", async () => {
      completed = true;
    });
    await Promise.resolve();

    expect(result).toBeUndefined();
    expect(completed).toBe(true);
  });
});
