# Architecture

The extension has two bundles produced by `esbuild.js`:

- **Extension host** (`dist/extension.js`) — Node/CommonJS, runs in VS Code.
- **Webview UI** (`dist/webview.js` + `dist/webview.css`) — React, runs in the chat panel.

They communicate over a typed message protocol (`src/shared/protocol.ts`).

```
┌───────────────────────────── Webview (React) ─────────────────────────────┐
│ App.tsx ── Composer / HistoryPanel / ToolCallView / MarkdownLite           │
│   │  postMessage(WebviewToHost)            onHostMessage(HostToWebview)  ▲  │
└───┼─────────────────────────────────────────────────────────────────────┼──┘
    ▼                                                                       │
┌───────────────────────── Extension host (Node) ───────────────────────────┐
│ extension.ts ── registers ChatViewProvider + commands                      │
│ ChatViewProvider ── orchestrates a turn:                                   │
│   • providers/registry → LanguageModel (Vercel AI SDK)                     │
│   • agent/prompt → system prompt (base + agent + rules + skills + memory)  │
│   • agent/tools → ToolSet (file, search, ide, exec, self-improve)          │
│   • agent/agent → AgentSession.run() → streamText(...).fullStream          │
│   • sessions → persist transcript + model history                          │
└────────────────────────────────────────────────────────────────────────────┘
```

## Module map

| Path | Responsibility |
| --- | --- |
| `src/extension.ts` | Activation, command + view registration. |
| `src/ChatViewProvider.ts` | Webview lifecycle, message routing, turn orchestration, attachments, sessions. |
| `src/providers/catalog.ts` | Static provider metadata (`PROVIDERS`, `ProviderId`). |
| `src/providers/registry.ts` | Builds AI SDK model/embedding instances from settings + secrets. |
| `src/agent/agent.ts` | `AgentSession` — wraps `streamText`, streams `fullStream`, keeps history. |
| `src/agent/tools.ts` | `buildTools(ctx, allowed)` → AI SDK `ToolSet`. |
| `src/agent/search.ts` | Three search tiers. |
| `src/agent/embeddings.ts` | `RepoIndex` — embedding-based semantic index. |
| `src/agent/skills.ts` | Rules loader + `SkillManager`. |
| `src/agent/agents.ts` | `AgentManager` — built-in + user agents. |
| `src/agent/memory.ts` | `MemoryStore` — durable notes. |
| `src/agent/prompt.ts` | System prompt assembly. |
| `src/sessions.ts` | `SessionStore` — chat history persistence. |
| `webview-ui/*` | React chat UI. |

## A turn, end to end

1. The webview sends `sendMessage { text, attachments }`.
2. `ChatViewProvider.handleSend` resolves the active agent, builds the model (per-agent override or active provider), and assembles the system prompt from project rules, memory, and skills.
3. It builds the `ToolSet` filtered by the agent's allowed tools.
4. `AgentSession.run` calls `streamText(...)`. Because every tool has an `execute` function and `stopWhen: stepCountIs(maxSteps)` is set, the AI SDK runs the full tool-calling loop internally.
5. `result.fullStream` parts are mapped to UI events (`assistantDelta`, `toolCall`, `toolResult`, `error`, `done`) and accumulated into a transcript.
6. On completion, the transcript and the model message history are persisted as a session.

## Why the AI SDK

The Vercel AI SDK provides a unified `streamText` interface, a large provider ecosystem (`@ai-sdk/*`), and a built-in agentic loop via `stopWhen`. This removes the need for per-provider HTTP/streaming code and normalizes tool calling across providers.

## Persisted workspace data

| Location | Contents |
| --- | --- |
| `<storage>/sessions/*.json` | Chat sessions (transcript + model history). |
| `<storage>/repo-index.json` | Tier 3 embedding index. |
| `.agentchat/agents/*.json` | User-defined agents. |
| `.agentchat/skills/*.md` | Reusable skills. |
| `.agentchat/memory.md` | Long-term agent memory. |

`<storage>` is the extension's workspace storage (`context.storageUri`).
