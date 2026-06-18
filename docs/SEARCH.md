# Search (three tiers)

The agent can search the codebase at three increasing levels of sophistication. Implementation lives in `src/agent/search.ts` and `src/agent/embeddings.ts`; the tools are exposed in `src/agent/tools.ts`.

## Tier 1 — keyword & filename

Fast, dependency-free, always available.

- **`find_files`** — match files by glob (e.g. `**/*.ts`). Backed by `vscode.workspace.findFiles`.
- **`search_text`** — substring search across file contents; returns `path:line: text`. Optional `include` glob narrows the scope.

Best for: locating a known string, file, or symbol name quickly.

## Tier 2 — symbols

Structure-aware search using the language servers already installed in VS Code.

- **`search_symbols`** — calls `vscode.executeWorkspaceSymbolProvider` to find functions, classes, methods, etc. by name, returning `kind Container.name — path:line`.

Best for: "where is `class FooService` / function `handleX` defined". Requires a language extension for the file type; falls back gracefully when none is present.

## Tier 3 — semantic (embeddings)

Meaning-based retrieval over an embedding index.

- **`index_repository`** — chunks workspace files, embeds them with `embedMany`, and persists vectors to `<storage>/repo-index.json`. Run once (or after large changes). Also available as **AI Agent: Build Repository Index**.
- **`search_semantic`** — embeds the query and returns the top-k chunks by cosine similarity.

Best for: conceptual questions like "where is rate limiting handled" when you don't know the exact terms.

### How indexing works

1. Enumerate workspace files, skipping `node_modules`, `.git`, build output, and binary/asset extensions, and files over ~200 KB.
2. Split each file into overlapping ~1500-char chunks.
3. Embed in batches via the configured embeddings provider.
4. Store `{ file, start, text, embedding }` entries as JSON.
5. Query with `embed(query)` + `cosineSimilarity`, sorted descending.

The index is provider-agnostic — configure `aiAgentChat.embeddings.provider` / `.model` independently from your chat provider.

## Guidance to the model

The system prompt tells the agent to investigate before acting. A typical flow is: Tier 1/2 to pinpoint exact locations, Tier 3 when the location is conceptual or unknown.
