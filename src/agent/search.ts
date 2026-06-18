import * as path from "path";
import * as vscode from "vscode";
import { RepoIndex } from "./embeddings";

const DEFAULT_EXCLUDE = "{**/node_modules/**,**/.git/**,**/dist/**,**/out/**}";

/** Tier 1a: find files whose path matches a glob pattern. */
export async function searchFilenames(
  glob: string,
  workspaceRoot: string,
  max = 100
): Promise<string> {
  const files = await vscode.workspace.findFiles(glob, DEFAULT_EXCLUDE, max);
  if (files.length === 0) {
    return `No files match '${glob}'.`;
  }
  return files
    .map((f) => path.relative(workspaceRoot, f.fsPath).replace(/\\/g, "/"))
    .sort()
    .join("\n");
}

/** Tier 1b: keyword search across file contents. */
export async function searchKeyword(
  query: string,
  workspaceRoot: string,
  include = "**/*",
  max = 100
): Promise<string> {
  const files = await vscode.workspace.findFiles(include, DEFAULT_EXCLUDE, 800);
  const results: string[] = [];
  const lowerQuery = query.toLowerCase();

  for (const file of files) {
    if (results.length >= max) {
      break;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(file);
      const text = Buffer.from(bytes).toString("utf8");
      if (text.includes("\u0000")) {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(lowerQuery)) {
          const rel = path.relative(workspaceRoot, file.fsPath).replace(/\\/g, "/");
          results.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
          if (results.length >= max) {
            break;
          }
        }
      }
    } catch {
      // skip unreadable files
    }
  }
  return results.length > 0 ? results.join("\n") : `No matches for '${query}'.`;
}

const SYMBOL_KINDS: Record<number, string> = {
  4: "class",
  5: "method",
  6: "property",
  8: "constructor",
  9: "enum",
  10: "interface",
  11: "function",
  12: "variable",
  13: "constant",
  22: "struct",
};

/** Tier 2: workspace symbol search via VS Code language providers. */
export async function searchSymbols(
  query: string,
  workspaceRoot: string,
  max = 60
): Promise<string> {
  const symbols =
    (await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      query
    )) ?? [];

  if (symbols.length === 0) {
    return `No symbols found for '${query}'. (Tier 2 needs a language extension for the file types.)`;
  }

  return symbols
    .slice(0, max)
    .map((s) => {
      const kind = SYMBOL_KINDS[s.kind] ?? "symbol";
      const rel = path
        .relative(workspaceRoot, s.location.uri.fsPath)
        .replace(/\\/g, "/");
      const line = s.location.range.start.line + 1;
      const container = s.containerName ? `${s.containerName}.` : "";
      return `${kind} ${container}${s.name} — ${rel}:${line}`;
    })
    .join("\n");
}

/** Tier 3: semantic search over the embedding index. */
export async function searchSemantic(
  query: string,
  index: RepoIndex,
  k = 8
): Promise<string> {
  await index.load();
  if (index.size === 0) {
    return "The semantic index is empty. Build it first with the 'index_repository' tool or the 'AI Agent: Build Repository Index' command.";
  }
  const hits = await index.query(query, k);
  if (hits.length === 0) {
    return `No semantic matches for '${query}'.`;
  }
  return hits
    .map(
      (h) =>
        `# ${h.file} (score ${h.score.toFixed(3)})\n${h.text.trim().slice(0, 600)}`
    )
    .join("\n\n---\n\n");
}
