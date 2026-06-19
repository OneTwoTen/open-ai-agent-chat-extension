import * as vscode from "vscode";

const INTEGRATED_BROWSER = "workbench.action.browser.open";
const SIMPLE_BROWSER_API = "simpleBrowser.api.open";
const SIMPLE_BROWSER_SHOW = "simpleBrowser.show";

export type OpenTarget = "auto" | "integratedBrowser" | "simpleBrowser" | "external";

export interface OpenUrlOptions {
  target?: OpenTarget;
  preserveFocus?: boolean;
  viewColumn?: vscode.ViewColumn;
  resolveRemoteLocalhost?: boolean;
}

export function configuredOpenTarget(): OpenTarget {
  const configured = vscode.workspace
    .getConfiguration("aiAgentChat")
    .get<string>("preview.openTarget", "auto");
  return isOpenTarget(configured) ? configured : "auto";
}

export function configuredResolveRemoteLocalhost(): boolean {
  return vscode.workspace
    .getConfiguration("aiAgentChat")
    .get<boolean>("preview.resolveRemoteLocalhost", true);
}

export function isOpenTarget(value: unknown): value is OpenTarget {
  return (
    value === "auto" ||
    value === "integratedBrowser" ||
    value === "simpleBrowser" ||
    value === "external"
  );
}

export function isLocalPreviewUri(uri: vscode.Uri): boolean {
  if (uri.scheme === "file") {
    return true;
  }
  if (uri.scheme !== "http" && uri.scheme !== "https") {
    return false;
  }

  const parsed = parseUrl(uri);
  if (!parsed) {
    return false;
  }
  return isLocalHostname(parsed.hostname);
}

export async function openUrl(
  input: string | vscode.Uri,
  options: OpenUrlOptions = {},
): Promise<void> {
  const target = options.target ?? "auto";
  let uri = typeof input === "string" ? parseInputUri(input) : input;

  if (options.resolveRemoteLocalhost !== false) {
    uri = await maybeResolveRemoteLocalhost(uri);
  }

  const commands = await vscode.commands.getCommands(true);

  if (
    (target === "auto" || target === "integratedBrowser") &&
    commands.includes(INTEGRATED_BROWSER)
  ) {
    await vscode.commands.executeCommand(INTEGRATED_BROWSER, uri.toString(true));
    return;
  }

  if (target === "auto" || target === "integratedBrowser" || target === "simpleBrowser") {
    if (commands.includes(SIMPLE_BROWSER_API)) {
      await vscode.commands.executeCommand(SIMPLE_BROWSER_API, uri, {
        preserveFocus: options.preserveFocus ?? false,
        viewColumn: options.viewColumn ?? vscode.ViewColumn.Beside,
      });
      return;
    }

    if (commands.includes(SIMPLE_BROWSER_SHOW)) {
      await vscode.commands.executeCommand(SIMPLE_BROWSER_SHOW, uri.toString(true));
      return;
    }
  }

  await vscode.env.openExternal(uri);
}

async function maybeResolveRemoteLocalhost(uri: vscode.Uri): Promise<vscode.Uri> {
  if (!vscode.env.remoteName || (uri.scheme !== "http" && uri.scheme !== "https")) {
    return uri;
  }

  const parsed = parseUrl(uri);
  if (!parsed || !isLocalHostname(parsed.hostname)) {
    return uri;
  }

  if (parsed.hostname.toLowerCase() === "0.0.0.0") {
    parsed.hostname = "localhost";
  }

  return vscode.env.asExternalUri(vscode.Uri.parse(parsed.toString()));
}

function parseInputUri(input: string): vscode.Uri {
  try {
    new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }
  return vscode.Uri.parse(input);
}

function parseUrl(uri: vscode.Uri): URL | undefined {
  try {
    return new URL(uri.toString(true));
  } catch {
    return undefined;
  }
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]"
  );
}
