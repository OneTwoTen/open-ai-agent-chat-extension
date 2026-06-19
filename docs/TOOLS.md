# Tools

Tools are defined in `src/agent/tools.ts` using the AI SDK `tool()` helper with zod input schemas. `buildTools(ctx, allowed)` returns the set, filtered by the active agent's allow-list. All paths are workspace-relative and validated against directory traversal.

## File operations

| Tool | Inputs | Notes |
| --- | --- | --- |
| `read_file` | `path` | Returns text (truncated at 60k chars). |
| `write_file` | `path`, `content` | Creates/overwrites. |
| `edit_file` | `path`, `oldText`, `newText`, `replaceAll?` | Exact-match replacement; refuses ambiguous matches unless `replaceAll`. |
| `delete_file` | `path`, `recursive?` | **Confirmation required**; uses trash. |
| `create_directory` | `path` | mkdir -p. |
| `move_file` | `from`, `to` | Rename/move. |
| `list_directory` | `path` | Lists entries (`.` for root). |

## Search

| Tool | Inputs | Tier |
| --- | --- | --- |
| `find_files` | `glob` | 1 |
| `search_text` | `query`, `include?` | 1 |
| `search_symbols` | `query` | 2 |
| `search_semantic` | `query`, `k?` | 3 |
| `index_repository` | — | builds the Tier 3 index |

See [SEARCH.md](SEARCH.md).

## IDE context

| Tool | Inputs | Notes |
| --- | --- | --- |
| `get_open_editors` | — | Files open in the editor. |
| `get_active_selection` | — | Active file path + selected text. |
| `get_diagnostics` | `path?` | Errors/warnings; optionally scoped to a file. |

## Execution & network

| Tool | Inputs | Notes |
| --- | --- | --- |
| `run_command` | `command` | **Confirmation required**; runs in workspace root, 120s timeout. |
| `fetch_url` | `url` | Fetches text content (truncated at 20k chars). |

## Self-improvement

| Tool | Inputs | Notes |
| --- | --- | --- |
| `remember` | `note` | Appends to `.agentchat/memory.md`. |
| `create_skill` | `name`, `body`, `description?`, `alwaysApply?` | Writes a skill to `.agentchat/skills`. |
| `delegate` | `agentId`, `task` | Runs an allowed sub-agent in isolation; returns its final result. Only present when the agent declares `subAgents`. |

## Safety

- `delete_file` and `run_command` prompt the user with a modal confirmation before acting.
- Path inputs are resolved inside the workspace; anything resolving outside is rejected by default.
- **External File Access**: To allow the agent to access files outside the workspace root, enable the `aiAgentChat.allowExternalFiles` setting in VS Code.
- Read-only agents (`ask`, `architect`) receive only non-mutating tools.

## Adding a tool

Add an entry to the object in `buildTools`:

```ts
my_tool: tool({
  description: "What it does and when to use it.",
  inputSchema: z.object({ arg: z.string() }),
  async execute({ arg }) {
    return "result string";
  },
}),
```

Add its name to read-only agents' allow-lists in `src/agent/agents.ts` if appropriate.
