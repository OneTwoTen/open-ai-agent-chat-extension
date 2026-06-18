# Telegram Bot

The Telegram integration lets a Telegram bot send requests to the same agent runtime used by the VS Code webview. It is useful for remote check-ins, quick code questions, and agent tasks when VS Code is already running on a trusted machine.

## Setup

1. Create a bot in Telegram with `@BotFather` and copy the bot token.
2. In VS Code, run `AI Agent: Set Telegram Bot Token`.
3. Open the AI Agent Chat view and choose the Telegram tab, or use VS Code settings directly.
4. Set `aiAgentChat.telegram.allowedChatIds` before exposing the bot beyond a private test chat.
5. Run `AI Agent: Start Telegram Bot`, then send `/start` to the bot from Telegram.

The token is stored in VS Code SecretStorage under `aiAgentChat.telegram.token`; it is not written to settings files.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `aiAgentChat.telegram.allowedChatIds` | `[]` | Telegram user, group, or chat IDs allowed to use the bot. Empty means any chat with the bot token can use it. |
| `aiAgentChat.telegram.workspacePath` | `""` | Absolute workspace path used by Telegram requests. Empty uses the first open VS Code workspace folder. |
| `aiAgentChat.telegram.startOnActivation` | `false` | Starts the bot when the extension activates, if a token is configured. |

Chat IDs can be positive user IDs or negative group/supergroup IDs. In a private chat, send `/status` after starting the bot to confirm the active chat and workspace behavior.

## Commands

| Command | Description |
| --- | --- |
| `/start` | Show the welcome message and command list. |
| `/help` | Show command help. |
| `/chat <text>` | Send a prompt to the active agent. Plain text messages without a slash do the same. |
| `/agent <name>` | Switch the chat session to another configured agent. |
| `/workspace` | Show the current workspace. |
| `/workspace list` | List open VS Code workspace folders. |
| `/workspace <index>` | Use a workspace folder by 1-based index for this Telegram chat. |
| `/session list` | List saved webview chat sessions. |
| `/session load <id>` | Load a saved session into the Telegram chat's agent history. |
| `/session info <id>` | Show saved session metadata. |
| `/session delete <id>` | Delete a saved session. |
| `/new` | Reset the Telegram chat's in-memory conversation. |
| `/cancel` | Abort the currently running request for the chat. |
| `/status` | Show agent, workspace, queue, and active-chat status. |

Documents and photos can be sent as attachment context. Text documents are decoded as UTF-8 and capped before being added to the model prompt. Photos are forwarded as data URLs when the selected provider/model supports image input.

## Runtime Behavior

- `src/extension.ts` creates one `TelegramBotManager` during activation and registers start/stop/token commands.
- `src/telegram/bot.ts` loads settings, creates the `grammy` bot, applies allowed-chat middleware, and registers handlers.
- `src/telegram/session.ts` keeps one in-memory `AgentSession` per Telegram chat, including active agent, workspace override, streaming message id, abort controller, and queue.
- `src/telegram/handlers.ts` maps Telegram commands, text, documents, photos, and confirmation callbacks into agent turns.
- `src/telegram/toolContext.ts` adapts the agent tool permission model to Telegram inline confirmations.
- `src/telegram/callbacks.ts` streams assistant deltas back to Telegram messages and sends a final usage summary.

Requests from the same chat run serially. If a request is already running, later messages are queued and executed after the active turn finishes.

## Security Notes

Treat the bot token like a remote control for the workspace. Prefer a private bot, set `allowedChatIds`, and keep the extension's global permission level at `readonly` or `ask` unless you intentionally want autonomous edits.

The Telegram path uses the same workspace path checks as the main agent tools, so file operations are still scoped to the selected workspace root. Destructive tools such as delete and shell execution require confirmation even when permission is `auto`.

Current implementation notes:

- If the bot was started while `allowedChatIds` was empty, adding IDs in settings does not install the authorization middleware until the bot is restarted.
- Telegram edit/write confirmation is concise and does not show the full diff preview that the webview can show.
- MCP servers are connected during Telegram turns; long-running MCP transports should be tested carefully in remote-bot workflows.
- Large or binary documents may not produce useful UTF-8 context even though Telegram can deliver the file.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Bot does not start | Confirm the token was set with `AI Agent: Set Telegram Bot Token`. |
| Bot starts but ignores a chat | Check whether the chat ID is present in `aiAgentChat.telegram.allowedChatIds`, then restart the bot after changing an empty allow-list to a restricted one. |
| Requests say no workspace is configured | Open a folder in VS Code, set `aiAgentChat.telegram.workspacePath`, or use `/workspace list` and `/workspace <index>`. |
| Model/API errors appear in Telegram | Set the active provider API key in VS Code and confirm the selected provider/model supports the requested tools or image input. |
| A request is stuck | Use `/cancel`, then check the VS Code Developer Tools console for provider, MCP, or network errors. |
