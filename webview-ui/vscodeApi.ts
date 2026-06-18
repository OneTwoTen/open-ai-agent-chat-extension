import { HostToWebview, WebviewToHost } from "../src/shared/protocol";

interface VsCodeApi {
  postMessage(msg: WebviewToHost): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

/** Singleton handle to the VS Code webview API. */
export const vscode = acquireVsCodeApi();

/** Subscribe to messages coming from the extension host. */
export function onHostMessage(handler: (msg: HostToWebview) => void): () => void {
  const listener = (event: MessageEvent) => handler(event.data as HostToWebview);
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
