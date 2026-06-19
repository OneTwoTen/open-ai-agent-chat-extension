# Roadmap

Prioritised next steps for the AI Agent Chat extension, based on a full codebase review (June 2026).

## Current state

| Metric | Value |
| --- | --- |
| Extension version | `0.0.2013` |
| Built-in tools | 20 (`TOOL_CATALOG` in `src/agent/tools.ts`) |
| Built-in agents | 5: Coder, Ask, Architect, Orchestrator, Reviewer |
| Providers | 17 (OpenAI, Anthropic, Google, Vertex, Azure, Bedrock, Mistral, Cohere, Groq, DeepSeek, Fireworks, Together AI, xAI, Cerebras, Perplexity, Ollama, Custom) |
| Tests | 89 passing across 16 files (Vitest, isolated) |
| Compile | `tsc --noEmit` — 0 errors |

---

## Priority 1 — First-class git tools

Git operations currently go through the generic `run_command` shell tool, which is fragile (parsing stdout), unsafe (unstructured), and always prompts for confirmation even for read-only queries.

**Proposal**: add dedicated tools with structured I/O and fine-grained permission:

| Tool | Description | Permission level |
| --- | --- | --- |
| `git_status` | Show working tree status (porcelain) | read-only |
| `git_diff` | Show unstaged / staged diff | read-only |
| `git_log` | Show recent commit history | read-only |
| `git_stage` | Stage files (`git add`) | ask |
| `git_unstage` | Unstage files (`git restore --staged`) | ask |
| `git_commit` | Create a commit with a message | ask |
| `git_branch` | List / create / switch branches | ask |
| `git_push` | Push to remote | ask |
| `git_pull` | Pull from remote | ask |

Implementation sketch:

```ts
git_status: tool({
  description: "Show the working tree status (porcelain format).",
  inputSchema: z.object({}),
  execute: () => execAsync("git status --porcelain", { cwd: ctx.workspaceRoot }),
}),
```

**Files to touch**: `src/agent/tools.ts`, `src/agent/agents.ts` (read-only allow-lists).

---

## Priority 2 — E2E VS Code integration tests

Current tests are isolated Vitest unit tests with no live VS Code extension host or webview.

**Goal**: add a test harness that exercises the full extension lifecycle:

- Use `@vscode/test-electron` to launch the extension in a headless VS Code window.
- Test `handleSend` → `AgentSession.run` → tool execution → webview message flow.
- Mock the LLM provider (return controlled tool-call sequences).
- Verify transcript, usage, working-set, and session persistence.

**Files to create**: `test/e2e/` directory with `extension.test.ts`.

---

## Priority 3 — Context window warnings + auto-summary

The `UsageBar` shows token counts and cost estimates, but there is no awareness of the model's context window limit. Long sessions silently fail when the context exceeds the model's capacity.

**Proposal**:

1. Track `totalTokens` against per-model context limits (e.g. 128k for claude-3-5-sonnet, 200k for gpt-4o).
2. Show a warning bar when usage exceeds 70% / 90% of the limit.
3. On exceeding 95%, offer an auto-summary flow: the agent reads the transcript and summarises early turns, then replaces them with a compressed `<summary>` block.
4. Add a per-turn `maxContextTokens` setting to let the user cap context manually.

**Files to touch**: `src/shared/protocol.ts` (add context limit to init), `chatViewProvider.ts` (check + warn), `webview-ui/components/UsageBar.tsx` (warning bar).

---

## Priority 4 — Workspace-scoped provider/model/baseUrl settings

Current scoping is split:

| Setting | Scope | Mechanism |
| --- | --- | --- |
| `agentId`, `reasoning`, `permission` | Workspace-local | `context.workspaceState` |
| Agents, skills, memory, MCP config | Workspace-local | `.agentchat/` files |
| `provider`, `model`, `baseUrl`, file-analysis | **Global** | `ConfigurationTarget.Global` |

**Goal**: unify provider settings scope so the user can have different providers/models per workspace.

```ts
// Proposed: per-workspace config key
// Workspace config > global fallback
provider: /* ws:aiAgentChat.provider ?? aiAgentChat.provider */
```

UI change: the provider/model selectors in the chat header currently apply globally. After this change they should detect whether the workspace has an override and show that.

**Files to touch**: `src/ChatViewProvider.ts`, `src/providers/registry.ts`, `webview-ui/App.tsx`.

---

## Priority 5 — Theme-aware syntax highlighting

Code blocks in chat (`react-markdown` + `remark-gfm`) currently render plain `<code>{text}</code>` with CSS. VS Code's `TextMate` token colours are not applied.

**Options** (from simplest to most complete):

| Approach | Effort | Result |
| --- | --- | --- |
| 1. Shiki light/dark theme bundle | Low | Coloured tokens, no VS Code theme sync |
| 2. VS Code `webview.postMessage` + CSS variables | Medium | Uses current VS Code theme colours |
| 3. `@vscode/markdown-webview` | High | Full VS Code markdown rendering |

Approach 2 is recommended: the webview already receives theme variables via `vscode-bridge.css`. Map `token.xxx` classes to these CSS custom properties.

**Files to touch**: `webview-ui/components/MarkdownLite.tsx`, `webview-ui/styles.css`.

---

## Priority 6 — Agent / Skill import-export + marketplace

Agents and skills are stored as files in `.agentchat/` and are fully editable in the UI, but there is no import/export UX beyond manual file copying.

**Proposal**:

1. **Export**: download an agent definition as `.agent.json` or a skill as `.skill.md` (the existing file format is already compatible).
2. **Import**: drag-and-drop or file-picker to install an agent/skill into `.agentchat/`.
3. **Marketplace** (later): a simple registry file (e.g. `community-agents.json`) that lists URLs of agent definitions, fetched on demand and displayed in a new "Browse" tab.

**Files to touch**: `webview-ui/panels/AgentsPanel.tsx`, `webview-ui/panels/SkillsPanel.tsx`, `src/agent/agents.ts`, `src/agent/skills.ts`.

---

## Priority 7 — Skill versioning / backup

The `create_skill` tool overwrites skill files directly. There is no history, diff, or undo.

**Proposal**:

- Add a `version` metadata field to the YAML frontmatter.
- On `create_skill`, write the previous version to `.agentchat/skills/.backups/<name>-v<N>.md`.
- Show a simple version list in the Skills editor UI.

**Files to touch**: `src/agent/skills.ts`, `webview-ui/panels/SkillsPanel.tsx`.
