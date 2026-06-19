import * as vscode from "vscode";
import { ChatViewProvider } from "./ChatViewProvider";
import { getActiveProviderId, PROVIDERS, PROVIDER_IDS, ProviderId, secretKeyFor } from "./providers";
import { TelegramBotManager } from "./telegram/bot";

export function activate(context: vscode.ExtensionContext): void {
  const telegramBot = new TelegramBotManager(context);
  const provider = new ChatViewProvider(context, telegramBot);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    provider,
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
    }),
    // ---- Telegram commands -------------------------------------------
    vscode.commands.registerCommand("aiAgentChat.startTelegram", () => telegramBot.start()),
    vscode.commands.registerCommand("aiAgentChat.stopTelegram", () => telegramBot.stop()),
    vscode.commands.registerCommand("aiAgentChat.setTelegramToken", async () => {
      const token = await vscode.window.showInputBox({
        title: "Set Telegram Bot Token",
        prompt: "Enter your Telegram bot token from @BotFather.",
        password: true,
        ignoreFocusOut: true,
        placeHolder: "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz",
      });
      if (token?.trim()) {
        await context.secrets.store("aiAgentChat.telegram.token", token.trim());
        vscode.window.showInformationMessage("Telegram bot token saved.");
      }
    }),
    telegramBot,
  );

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    context.subscriptions.push(
      vscode.commands.registerCommand("aiAgentChat.e2e.runScenario", (input) =>
        provider.runE2EScenario(input)
      )
    );
  }

  // Auto-start Telegram bot if configured
  telegramBot.tryAutoStart();
}

export function deactivate(): void {
  // Telegram bot cleanup is handled by its disposable registration
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
