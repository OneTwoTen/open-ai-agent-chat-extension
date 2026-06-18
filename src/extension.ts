import * as vscode from "vscode";
import { ChatViewProvider } from "./ChatViewProvider";
import { getActiveProviderId, PROVIDERS, PROVIDER_IDS, ProviderId, secretKeyFor } from "./providers";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ChatViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("aiAgentChat.newChat", () => provider.newChat()),
    vscode.commands.registerCommand("aiAgentChat.openInEditor", () => provider.openInEditor()),
    vscode.commands.registerCommand("aiAgentChat.quickChat", () => provider.quickChat()),
    vscode.commands.registerCommand("aiAgentChat.inlineChat", () => provider.inlineChat()),
    vscode.commands.registerCommand("aiAgentChat.buildIndex", () => provider.buildIndexNow()),
    vscode.commands.registerCommand("aiAgentChat.setApiKey", async () => {
      const picked = await pickProvider();
      if (!picked) {
        return;
      }
      if (!PROVIDERS[picked].requiresApiKey) {
        vscode.window.showInformationMessage(
          `${PROVIDERS[picked].label} does not require an API key (configure via settings/env).`
        );
        return;
      }
      const key = await vscode.window.showInputBox({
        title: `Set API key for ${PROVIDERS[picked].label}`,
        prompt: "Stored securely in VS Code SecretStorage.",
        password: true,
        ignoreFocusOut: true,
      });
      if (key) {
        await context.secrets.store(secretKeyFor(picked), key.trim());
        vscode.window.showInformationMessage(`API key saved for ${PROVIDERS[picked].label}.`);
      }
    }),
    vscode.commands.registerCommand("aiAgentChat.clearApiKey", async () => {
      const picked = await pickProvider();
      if (!picked) {
        return;
      }
      await context.secrets.delete(secretKeyFor(picked));
      vscode.window.showInformationMessage(`API key cleared for ${PROVIDERS[picked].label}.`);
    })
  );
}

export function deactivate(): void {
  // nothing to clean up
}

async function pickProvider(): Promise<ProviderId | undefined> {
  const active = getActiveProviderId();
  const choice = await vscode.window.showQuickPick(
    PROVIDER_IDS.map((id) => ({
      label: PROVIDERS[id].label,
      description: id === active ? "active" : undefined,
      id,
    })),
    { title: "Select a provider" }
  );
  return choice?.id;
}
