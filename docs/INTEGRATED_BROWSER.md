# Integrated Browser compatibility

This document describes how AI Agent Chat should integrate with VS Code's
Integrated Browser feature. The goal is good compatibility for opening,
previewing, and debugging URLs inside VS Code, while avoiding unsupported
assumptions about controlling browser tabs.

## Summary

VS Code's Integrated Browser can open web pages directly inside the editor. It
supports `http://`, `https://`, and `file://` URLs, multiple browser editor tabs,
history, DevTools, session storage, remote browsing behavior, and debugging via
the `editor-browser` debug type.

The feature is still documented by VS Code as experimental, so this extension
should treat it as an optional capability:

1. Prefer the Integrated Browser when it is available.
2. Fall back to Simple Browser on older VS Code builds.
3. Fall back to the system browser when no in-editor browser is available.

Do not design this feature as "control the Integrated Browser like a Chrome
extension." VS Code exposes browser tools to Copilot/agent chat, but those tools
are not a stable public extension API for arbitrary third-party extension agent
loops.

Sources:

- VS Code Integrated Browser docs:
  https://code.visualstudio.com/docs/debugtest/integrated-browser
- VS Code built-in Simple Browser source:
  https://github.com/microsoft/vscode/blob/main/extensions/simple-browser/src/extension.ts
- VS Code built-in command docs:
  https://code.visualstudio.com/api/references/commands
- VS Code API docs for `env.openExternal` and `env.asExternalUri`:
  https://code.visualstudio.com/api/references/vscode-api
- Public issue tracking arbitrary external-link routing to Integrated Browser:
  https://github.com/microsoft/vscode/issues/311064

## Goals

- Open documentation, localhost previews, generated artifacts, and dev-server
  URLs inside VS Code when possible.
- Keep behavior predictable across VS Code Stable, Insiders, older builds, and
  remote workspaces.
- Give users a setting to choose where preview URLs open.
- Provide a reusable host-side URL opening abstraction so webview UI, agent
  tools, and commands use the same behavior.
- Support future debug flows with the `editor-browser` debug type.

## Non-goals

- Read DOM, cookies, localStorage, or console logs from arbitrary Integrated
  Browser tabs.
- Click, type, hover, drag, or run Playwright code against existing Integrated
  Browser tabs through an assumed extension API.
- Replace Integrated Browser with a custom VS Code webview for real web-app
  previewing.
- Mutate VS Code user settings such as `workbench.browser.openLocalhostLinks`
  without explicit user action.

## Current extension state

Today, links rendered in chat markdown post an `openExternal` message from the
webview:

- `webview-ui/components/MarkdownLite.tsx`
- `src/shared/protocol.ts`
- `src/ChatViewProvider.ts`

The extension host handles that message with:

```ts
vscode.env.openExternal(vscode.Uri.parse(msg.url));
```

That is not ideal for Integrated Browser support because `openExternal` is meant
to open the URI using the system's external handler, such as the user's default
browser for `http` and `https` URLs.

## VS Code commands and fallback order

The practical Integrated Browser command is:

```ts
workbench.action.browser.open
```

The built-in Simple Browser extension uses this command when it is available.
Because the Integrated Browser is experimental and this command is not a
first-class stable public browser API, the extension must feature-detect it:

```ts
const commands = await vscode.commands.getCommands(true);
const hasIntegratedBrowser = commands.includes("workbench.action.browser.open");
```

Recommended fallback order:

1. `workbench.action.browser.open`
2. `simpleBrowser.api.open`
3. `simpleBrowser.show`
4. `vscode.env.openExternal`

This gives good behavior across new VS Code builds, older VS Code builds, and
minimal environments.

## User settings

Add extension-owned settings under the existing `aiAgentChat.*` namespace:

```json
{
  "aiAgentChat.preview.openTarget": {
    "type": "string",
    "enum": ["auto", "integratedBrowser", "simpleBrowser", "external"],
    "default": "auto",
    "description": "Where AI Agent Chat opens preview and documentation URLs."
  },
  "aiAgentChat.preview.resolveRemoteLocalhost": {
    "type": "boolean",
    "default": true,
    "description": "Resolve remote localhost URLs through VS Code before opening previews."
  }
}
```

Target behavior:

| Target | Behavior |
| --- | --- |
| `auto` | Integrated Browser if available, otherwise Simple Browser, otherwise external browser. |
| `integratedBrowser` | Prefer Integrated Browser, with fallback if the command is unavailable. |
| `simpleBrowser` | Prefer Simple Browser, with fallback to external browser. |
| `external` | Always use `vscode.env.openExternal`. |

`auto` is the recommended default because it preserves compatibility while
allowing VS Code to improve its browser implementation over time.

## URL opening abstraction

Create a host-side helper, for example `src/browser/openUrl.ts`.

The helper should be the only place where browser commands and fallback logic
live. Webview messages, commands, and future tools should call this helper
instead of calling `executeCommand` or `openExternal` directly.

Recommended shape:

```ts
import * as vscode from "vscode";

const INTEGRATED_BROWSER = "workbench.action.browser.open";
const SIMPLE_BROWSER_API = "simpleBrowser.api.open";
const SIMPLE_BROWSER_SHOW = "simpleBrowser.show";

export type OpenTarget =
  | "auto"
  | "integratedBrowser"
  | "simpleBrowser"
  | "external";

export interface OpenUrlOptions {
  target?: OpenTarget;
  preserveFocus?: boolean;
  viewColumn?: vscode.ViewColumn;
  resolveRemoteLocalhost?: boolean;
}

export async function openUrl(
  input: string | vscode.Uri,
  options: OpenUrlOptions = {}
): Promise<void> {
  const target = options.target ?? "auto";
  let uri = typeof input === "string" ? vscode.Uri.parse(input) : input;

  if (options.resolveRemoteLocalhost !== false) {
    uri = await maybeResolveRemoteLocalhost(uri);
  }

  const commands = await vscode.commands.getCommands(true);

  if (
    target !== "simpleBrowser" &&
    target !== "external" &&
    commands.includes(INTEGRATED_BROWSER)
  ) {
    await vscode.commands.executeCommand(INTEGRATED_BROWSER, uri.toString(true));
    return;
  }

  if (target !== "integratedBrowser" && target !== "external") {
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
```

The exact implementation should include a robust `maybeResolveRemoteLocalhost`
helper, described below.

## Remote localhost handling

Remote workspaces need special handling. Examples include SSH, WSL, Dev
Containers, Tunnels, and Codespaces.

If the extension host is remote and the URL points at localhost, the user
interface may not be able to reach that address directly. VS Code provides:

```ts
await vscode.env.asExternalUri(uri);
```

Use it for localhost-style URLs when
`aiAgentChat.preview.resolveRemoteLocalhost` is enabled.

Hostnames to treat as local:

- `localhost`
- `127.0.0.1`
- `0.0.0.0`
- `::1`
- `[::1]`

Implementation notes:

- Parse with `new URL(uri.toString(true))` inside a `try/catch`.
- Do not rely only on `uri.authority.split(":")[0]`; that is fragile for IPv6.
- Consider normalizing `0.0.0.0` to `localhost` before opening because browsers
  do not always treat `0.0.0.0` as a useful destination.
- If `vscode.env.remoteName` is falsy, skip `asExternalUri`.

Sketch:

```ts
async function maybeResolveRemoteLocalhost(uri: vscode.Uri): Promise<vscode.Uri> {
  if (!vscode.env.remoteName || uri.scheme !== "http" && uri.scheme !== "https") {
    return uri;
  }

  let parsed: URL;
  try {
    parsed = new URL(uri.toString(true));
  } catch {
    return uri;
  }

  const host = parsed.hostname.toLowerCase();
  const isLocalhost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]";

  if (!isLocalhost) {
    return uri;
  }

  if (host === "0.0.0.0") {
    parsed.hostname = "localhost";
  }

  return vscode.env.asExternalUri(vscode.Uri.parse(parsed.toString()));
}
```

## Webview link behavior

Rename the webview message from `openExternal` to a more intentional name, for
example `openUrl`, while keeping `openExternal` temporarily if backward
compatibility is useful in tests.

Recommended protocol:

```ts
| { type: "openUrl"; url: string; target?: OpenTarget }
```

The default target should come from `aiAgentChat.preview.openTarget`, not from
the webview. The webview may pass an explicit target only for a UI action that
clearly says where it will open.

Suggested UI behavior:

- Normal markdown links use the configured default target.
- A future context menu may offer:
  - Open in VS Code
  - Open in external browser
- Do not use `target="_blank"` in the webview for trusted opening behavior.
  Always route through the extension host.

## Commands

Add extension commands that reuse `openUrl()`:

```json
{
  "command": "aiAgentChat.openUrl",
  "title": "AI Agent: Open URL"
},
{
  "command": "aiAgentChat.openPreviewInBrowser",
  "title": "AI Agent: Open Preview in Browser"
}
```

Potential command behavior:

- Ask for a URL if none is supplied.
- Remember the last preview URL in workspace state.
- Use `aiAgentChat.preview.openTarget` by default.
- For "Open Preview in Browser", prefer `integratedBrowser` or `auto`.

## Agent tool design

Add a lightweight, non-mutating tool only after the host helper is stable:

```ts
open_browser_url: tool({
  description:
    "Open a URL in the configured VS Code preview browser. Use for local dev servers, docs, or generated files.",
  inputSchema: z.object({
    url: z.string().url(),
    target: z.enum(["auto", "integratedBrowser", "simpleBrowser", "external"]).optional(),
  }),
  async execute({ url, target }) {
    await openUrl(url, { target: target ?? configuredTarget });
    return `Opened ${url}.`;
  },
})
```

Permission recommendation:

- Treat `open_browser_url` as non-mutating.
- It may still reveal URLs to remote services if the agent opens external pages,
  so consider a confirmation prompt for non-local URLs when permission is not
  `auto`.
- Localhost URLs are safe enough to open without extra confirmation in most
  preview flows.

Do not name this tool `click_browser`, `read_browser`, or similar unless the
extension implements its own browser automation backend.

## Debug integration

VS Code supports debugging in the Integrated Browser through `editor-browser`.
This is useful for web projects where the agent starts a dev server and then
opens or attaches a debugger to the preview.

Launch a new Integrated Browser tab:

```ts
await vscode.debug.startDebugging(undefined, {
  type: "editor-browser",
  request: "launch",
  name: "Launch in Integrated Browser",
  url: "http://localhost:3000",
  webRoot: "${workspaceFolder}",
});
```

Attach to an existing Integrated Browser tab:

```ts
await vscode.debug.startDebugging(undefined, {
  type: "editor-browser",
  request: "attach",
  name: "Attach to Integrated Browser",
  urlFilter: "http://localhost:3000/*",
});
```

Because this debug type is new and tied to the evolving Integrated Browser, the
extension should fail softly:

- Show a friendly error if `startDebugging` returns `false` or throws.
- Tell the user that their VS Code build may not support `editor-browser`.
- Keep the normal `openUrl()` preview path available even when debugging is not.

## Security and trust

The extension should preserve the existing permission model:

- Opening a local preview URL is non-mutating.
- Opening an arbitrary external URL may have privacy implications.
- Do not automatically open model-generated external URLs unless the user asked
  for preview or the active permission mode allows it.
- Keep all URL opening in the extension host so the webview cannot bypass policy.
- Use VS Code workspace trust and remote behavior rather than custom networking
  hacks.

Recommended confirmation policy:

| URL kind | `readonly` | `ask` | `auto` |
| --- | --- | --- | --- |
| `localhost`, `127.0.0.1`, `file` inside workspace | Allow | Allow | Allow |
| Public `http`/`https` docs generated by assistant | Ask | Ask | Allow |
| Non-HTTP schemes | Block except explicitly supported schemes | Block except explicitly supported schemes | Ask |

## Testing strategy

Unit tests:

- `openUrl()` chooses Integrated Browser when `workbench.action.browser.open`
  exists.
- It falls back to `simpleBrowser.api.open`.
- It falls back to `simpleBrowser.show`.
- It finally falls back to `vscode.env.openExternal`.
- Remote localhost URLs call `asExternalUri`.
- External URLs do not call `asExternalUri`.
- Invalid URLs fail with a clear error.

E2E tests:

- In VS Code extension host, run the command with a localhost URL.
- Verify that no exception is thrown.
- Where possible, assert the command path by stubbing `vscode.commands`.

Manual tests:

1. Open `https://code.visualstudio.com` from a chat markdown link.
2. Open `http://localhost:3000` from a chat markdown link.
3. Switch `aiAgentChat.preview.openTarget` to `external` and verify it uses the
   system browser.
4. Disable or simulate absence of `workbench.action.browser.open` and verify
   Simple Browser fallback.
5. Run from WSL or SSH and verify localhost forwarding.
6. Start an `editor-browser` debug launch config against a local dev server.

## Implementation checklist

1. Add `src/browser/openUrl.ts`.
2. Add `aiAgentChat.preview.openTarget` and
   `aiAgentChat.preview.resolveRemoteLocalhost` to `package.json`.
3. Replace `vscode.env.openExternal` in `ChatViewProvider` with `openUrl()`.
4. Add or rename webview protocol message to `openUrl`.
5. Add tests for fallback behavior.
6. Add `open_browser_url` to the agent tool catalog.
7. Add optional command palette commands for opening previews.
8. Add optional `editor-browser` debug helpers after the basic open flow is
   stable.

## Future work

If VS Code later exposes a public API for Integrated Browser tabs or browser
agent tools, revisit this design. At that point, the extension can add deeper
capabilities such as reading page content, collecting console logs, taking
screenshots, and running structured browser actions against the actual VS Code
Integrated Browser.

Until then, any true browser automation should use a separate, explicit backend
such as Playwright or a controlled app-side bridge.
