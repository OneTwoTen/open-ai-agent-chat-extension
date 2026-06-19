import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { openUrl } from "../src/browser/openUrl";

const commands = vscode.commands as unknown as {
  getCommands: ReturnType<typeof vi.fn>;
  executeCommand: ReturnType<typeof vi.fn>;
};
const env = vscode.env as unknown as {
  remoteName?: string;
  asExternalUri: ReturnType<typeof vi.fn>;
  openExternal: ReturnType<typeof vi.fn>;
};

describe("openUrl", () => {
  beforeEach(() => {
    commands.getCommands = vi.fn(async () => []);
    commands.executeCommand = vi.fn(async () => undefined);
    env.remoteName = undefined;
    env.asExternalUri = vi.fn(async (uri) => uri);
    env.openExternal = vi.fn(async () => true);
  });

  it("prefers the Integrated Browser command when available", async () => {
    commands.getCommands.mockResolvedValue(["workbench.action.browser.open"]);

    await openUrl("http://localhost:3000");

    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.browser.open",
      "http://localhost:3000",
    );
    expect(env.openExternal).not.toHaveBeenCalled();
  });

  it("falls back to simpleBrowser.api.open before external", async () => {
    commands.getCommands.mockResolvedValue(["simpleBrowser.api.open"]);

    await openUrl("https://example.com");

    expect(commands.executeCommand).toHaveBeenCalledWith(
      "simpleBrowser.api.open",
      expect.anything(),
      { preserveFocus: false, viewColumn: vscode.ViewColumn.Beside },
    );
    expect(env.openExternal).not.toHaveBeenCalled();
  });

  it("falls back to simpleBrowser.show before external", async () => {
    commands.getCommands.mockResolvedValue(["simpleBrowser.show"]);

    await openUrl("https://example.com");

    expect(commands.executeCommand).toHaveBeenCalledWith(
      "simpleBrowser.show",
      "https://example.com",
    );
    expect(env.openExternal).not.toHaveBeenCalled();
  });

  it("opens externally when no in-editor browser command exists", async () => {
    await openUrl("https://example.com");

    expect(commands.executeCommand).not.toHaveBeenCalled();
    expect(env.openExternal).toHaveBeenCalledWith(expect.anything());
  });

  it("resolves remote localhost URLs through VS Code", async () => {
    env.remoteName = "ssh-remote";
    env.asExternalUri.mockImplementation(async () => vscode.Uri.parse("https://forwarded.example"));

    await openUrl("http://127.0.0.1:5173");

    expect(env.asExternalUri).toHaveBeenCalled();
    expect(env.openExternal).toHaveBeenCalledWith(expect.objectContaining({
      path: "https://forwarded.example",
    }));
  });

  it("does not resolve external URLs through VS Code remote forwarding", async () => {
    env.remoteName = "ssh-remote";

    await openUrl("https://example.com");

    expect(env.asExternalUri).not.toHaveBeenCalled();
  });
});
