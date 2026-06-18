# AI Agent Chat

An agentic coding assistant for VS Code — a Copilot-Chat-style experience that runs on **your own** model providers. Multi-provider, full agent loop with tool calling, three-tier code search, IDE/CLI rules compatibility, multi-agent + skills, self-improvement, chat history, and drag-and-drop file attachments.

> Built on the [Vercel AI SDK](https://sdk.vercel.ai) v6. No dependency on GitHub Copilot.

## Features

- **Mantine UI** organized into tabs: **Chat**, **Agents**, **Skills**, **MCP**, **Telegram** — themed to match your VS Code color theme.
- **Many providers, your keys.** OpenAI, Anthropic, Google Gemini, Google Vertex, Azure OpenAI, Amazon Bedrock, Mistral, Cohere, Groq, DeepSeek, Fireworks, Together AI, xAI Grok, Cerebras, Perplexity, Ollama (local), and any OpenAI-compatible endpoint. Switch live from the header.
- **Reasoning effort & permission levels.** Dial reasoning (off/low/medium/high) for capable models; set the agent's autonomy (read-only / ask before edits / autonomous).
- **Token & cache analytics.** Live input/output/reasoning tokens, cache hit rate, per-step (per-task) breakdown, and session totals.
- **Capability display.** See what the active provider supports (tools, reasoning, images, prompt caching) and which tool each step called.
- **Full agent loop.** The AI SDK drives the tool-execution loop (`stopWhen`/`stepCountIs`).
- **Rich tool set.** File read/write/edit/delete/move, directory ops, command execution (gated by permission), URL fetch, editor/diagnostics inspection, memory, and skill creation.
- **Three-tier search.** Keyword + filename (Tier 1), symbols via language servers (Tier 2), semantic embeddings (Tier 3).
- **IDE/CLI rules compatibility.** Loads `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.cursor/rules/*`, `.github/copilot-instructions.md`, `.windsurfrules`, `.clinerules`, `.kiro/steering/*`.
- **Multiple agents + sub-agents + skills.** Built-in Coder / Ask / Architect, plus user-defined agents (with delegation), and reusable skills — all editable in the UI.
- **MCP.** Connect Model Context Protocol servers (stdio/SSE/HTTP); their tools merge into the agent's toolset. Reads the `mcpServers` map format too.
- **Self-improvement.** Persist durable facts to memory and author reusable skills.
- **Chat history & drag-and-drop attachments.**
- **Copilot-style UX.** Full-screen "open in editor" mode, `#` picker to reference files/folders, `/` slash commands, context chips (selection/file/problems/changes), full markdown rendering, model badge per answer, and copy / insert-at-cursor / insert-into-new-file on code blocks.
- **Analyze chats.** Review one or more sessions for a quality assessment + problems + suggestions, and auto-persist improvements as skills/memory.
- **Telegram bot bridge.** Start a Telegram bot from VS Code, restrict allowed chat IDs, switch agents/workspaces, send attachments, and run the same tool-enabled agent loop remotely.

## Quick start

```bash
npm install
npm run build      # or: npm run watch
```

Then press **F5** in VS Code to launch the Extension Development Host. Open the **AI Agent Chat** view from the Activity Bar.

1. Pick a provider in the chat header.
2. Run **AI Agent: Set Provider API Key** (Command Palette) to store your key securely. Ollama needs no key.
3. (Optional) Run **AI Agent: Build Repository Index** to enable Tier 3 semantic search.
4. Start chatting.

**Place it on the right (like Copilot):** enable View → Appearance → Secondary Side Bar, then drag the "AI Agent Chat" view into it — VS Code remembers the location. Or click the **full-screen** button in the header to open the chat as an editor tab. Type `#` in the input to reference a file or folder.

## Scripts

| Script | Description |
| --- | --- |
| `npm run build` | Production build of the extension + webview into `dist/`. |
| `npm run watch` | Incremental rebuild on change. |
| `npm run compile` | Type-check only (`tsc --noEmit`). |
| `npm run package` | Build a `.vsix` with `vsce`. |

## Configuration

Settings live under the `aiAgentChat.*` namespace. See [docs/PROVIDERS.md](docs/PROVIDERS.md) for credentials per provider.

| Setting | Default | Purpose |
| --- | --- | --- |
| `aiAgentChat.provider` | `openai` | Active provider id. |
| `aiAgentChat.model` | `""` | Model id override (empty = provider default). |
| `aiAgentChat.baseUrl` | `""` | Custom base URL (OpenAI/Azure/Ollama/Custom). |
| `aiAgentChat.embeddings.provider` | `openai` | Provider used for Tier 3 embeddings. |
| `aiAgentChat.embeddings.model` | `""` | Embedding model id. |
| `aiAgentChat.reasoning` | `off` | Default reasoning effort (off/low/medium/high). |
| `aiAgentChat.permission` | `ask` | Agent autonomy: readonly / ask / auto. |
| `aiAgentChat.maxAgentSteps` | `25` | Max tool-calling iterations per turn. |
| `aiAgentChat.telegram.allowedChatIds` | `[]` | Telegram chat/user IDs allowed to use the bot. Empty allows any chat with the bot token. |
| `aiAgentChat.telegram.workspacePath` | `""` | Workspace root used by Telegram requests. Empty uses the first VS Code workspace folder. |
| `aiAgentChat.telegram.startOnActivation` | `true` | Start the Telegram bot when the extension activates, if a token is configured. |

API keys are stored in VS Code **SecretStorage**, never in settings.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules and data flow.
- [docs/PROVIDERS.md](docs/PROVIDERS.md) — provider list, credentials, base URLs.
- [docs/SEARCH.md](docs/SEARCH.md) — the three search tiers.
- [docs/AGENTS_AND_SKILLS.md](docs/AGENTS_AND_SKILLS.md) — agents, skills, rules, memory.
- [docs/TOOLS.md](docs/TOOLS.md) — the agent's tools.
- [docs/TELEGRAM.md](docs/TELEGRAM.md) — Telegram bot setup, commands, runtime behavior, and security notes.
- [docs/TOKEN_OPTIMIZATION.md](docs/TOKEN_OPTIMIZATION.md) — cache-hit and multi-agent token strategy.
- [docs/COPILOT_PARITY.md](docs/COPILOT_PARITY.md) — Copilot-Chat research, parity status, and feature proposals.

## Security notes

- **Command execution and file deletion require explicit confirmation** via a modal dialog.
- API keys live in SecretStorage; cloud providers (Bedrock/Vertex) read credentials from environment/config.
- Tools are sandboxed to the workspace folder; paths outside the workspace are rejected.
- Telegram bot tokens live in SecretStorage; configure `aiAgentChat.telegram.allowedChatIds` before using the bot outside a private test chat.

## Status

Compiles cleanly (`tsc`) and bundles (`esbuild`). End-to-end runtime behaviour should be validated in the Extension Development Host (F5) with a real provider key.
