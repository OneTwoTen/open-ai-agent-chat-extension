import { tool, type ToolSet } from "ai";
import { exec } from "child_process";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";
import { z } from "zod";
import { isLocalPreviewUri, isOpenTarget, OpenTarget } from "../browser/openUrl";
import { MUTATING_TOOLS, PermissionLevel } from "../providers/catalog";
import { RepoIndex } from "./embeddings";
import { MemoryStore } from "./memory";
import {
  searchFilenames,
  searchKeyword,
  searchSemantic,
  searchSymbols,
} from "./search";
import { SkillManager } from "./skills";

const execAsync = promisify(exec);

/** Shared state and capabilities passed to every tool. */
export interface ToolContext {
  workspaceRoot: string;
  permission: PermissionLevel;
  allowExternalFiles: boolean;
  confirm: (title: string, detail: string) => Promise<boolean>;
  repoIndex: RepoIndex;
  memory: MemoryStore;
  skills: SkillManager;
  onNote?: (msg: string) => void;
  /**
   * Preview a proposed full-file edit and return true only when the user accepts it.
   * Hosts can show an editor diff; tests and non-UI callers may omit this to keep
   * the legacy direct-write behavior.
   */
  previewEdit?: (path: string, original: string, updated: string) => Promise<boolean>;
  /** Sub-agent ids this agent may delegate to. */
  allowedSubAgents?: string[];
  /** Runs a sub-agent in an isolated context and returns its final text. */
  delegate?: (agentId: string, task: string) => Promise<string>;
  /** Track a file modification for the working set. */
  trackFileChange?: (path: string, status: "created" | "modified" | "deleted" | "moved", fromPath?: string) => void;
  /** Open a URL using the host's configured preview browser. */
  openUrl?: (url: string, options?: { target?: OpenTarget }) => Promise<void>;
}

const CONFIRM_TITLES: Record<string, string> = {
  write_file: "Write file?",
  edit_file: "Edit file?",
  create_directory: "Create folder?",
  move_file: "Move file?",
  delete_file: "Delete?",
  run_command: "Run shell command?",
  git_stage: "Stage files?",
  git_unstage: "Unstage files?",
  git_commit: "Create commit?",
  git_branch: "Switch branch?",
  git_push: "Push to remote?",
  git_pull: "Pull from remote?",
};

/**
 * Decide whether a mutating tool may proceed, based on the permission level.
 * In `auto` mode, all mutating tools proceed without confirmation.
 */
async function ensure(ctx: ToolContext, name: string, detail: string): Promise<boolean> {
  if (ctx.permission === "auto") {
    return true;
  }
  return ctx.confirm(CONFIRM_TITLES[name] ?? "Proceed?", detail);
}

function resolveInWorkspace(root: string, p: string, allowExternal = false): string {
  const resolved = path.resolve(root, p);
  if (allowExternal) {
    return resolved;
  }
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path '${p}' is outside the workspace.`);
  }
  return resolved;
}

function rel(root: string, fsPath: string): string {
  return path.relative(root, fsPath).replace(/\\/g, "/");
}

/**
 * Build the full tool set bound to a context, optionally filtered to an
 * allow-list of tool names (used to scope read-only agents).
 */
export function buildTools(ctx: ToolContext, allowed: string[] | "all"): ToolSet {
  const all: ToolSet = {
    read_file: tool({
      description: "Read the text contents of a workspace file.",
      inputSchema: z.object({ path: z.string().describe("Workspace-relative path.") }),
      async execute({ path: p }) {
        const fp = resolveInWorkspace(ctx.workspaceRoot, p, ctx.allowExternalFiles);
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(fp));
        const text = Buffer.from(bytes).toString("utf8");
        const MAX = 60_000;
        return text.length > MAX
          ? text.slice(0, MAX) + `\n[...truncated ${text.length - MAX} chars]`
          : text;
      },
    }),

    write_file: tool({
      description: "Create or overwrite a file with the given full content.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
      }),
      async execute({ path: p, content }) {
        const fp = resolveInWorkspace(ctx.workspaceRoot, p, ctx.allowExternalFiles);
        if (!(await ensure(ctx, "write_file", p))) {
          return "Write declined by the user.";
        }
        let original = "";
        try {
          original = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(fp))).toString("utf8");
        } catch {
          original = "";
        }
        if (ctx.permission !== "auto" && ctx.previewEdit && !(await ctx.previewEdit(p, original, content))) {
          return "Write rejected by the user.";
        }
        await vscode.workspace.fs.writeFile(vscode.Uri.file(fp), Buffer.from(content, "utf8"));
        ctx.trackFileChange?.(p, original ? "modified" : "created");
        return `Wrote ${content.length} chars to ${p}.`;
      },
    }),

    edit_file: tool({
      description:
        "Edit a file by replacing an exact text snippet. oldText must match exactly. Use for targeted changes instead of rewriting whole files.",
      inputSchema: z.object({
        path: z.string(),
        oldText: z.string().describe("Exact text to find."),
        newText: z.string().describe("Replacement text."),
        replaceAll: z.boolean().optional(),
      }),
      async execute({ path: p, oldText, newText, replaceAll }) {
        const fp = resolveInWorkspace(ctx.workspaceRoot, p, ctx.allowExternalFiles);
        const uri = vscode.Uri.file(fp);
        const original = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
        if (!original.includes(oldText)) {
          return `Error: oldText not found in ${p}. Read the file and retry with an exact match.`;
        }
        const occurrences = original.split(oldText).length - 1;
        if (!replaceAll && occurrences > 1) {
          return `Error: oldText appears ${occurrences} times in ${p}. Add more context to make it unique, or set replaceAll.`;
        }
        if (!(await ensure(ctx, "edit_file", p))) {
          return "Edit declined by the user.";
        }
        const updated = replaceAll
          ? original.split(oldText).join(newText)
          : original.replace(oldText, newText);
        if (ctx.permission !== "auto" && ctx.previewEdit && !(await ctx.previewEdit(p, original, updated))) {
          return "Edit rejected by the user.";
        }
        await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, "utf8"));
        ctx.trackFileChange?.(p, "modified");
        return `Edited ${p} (${replaceAll ? occurrences : 1} replacement).`;
      },
    }),

    delete_file: tool({
      description: "Delete a file or directory. Requires user confirmation.",
      inputSchema: z.object({ path: z.string(), recursive: z.boolean().optional() }),
      async execute({ path: p, recursive }) {
        const fp = resolveInWorkspace(ctx.workspaceRoot, p, ctx.allowExternalFiles);
        if (!(await ensure(ctx, "delete_file", p))) {
          return "Deletion declined by the user.";
        }
        await vscode.workspace.fs.delete(vscode.Uri.file(fp), {
          recursive: !!recursive,
          useTrash: true,
        });
        ctx.trackFileChange?.(p, "deleted");
        return `Deleted ${p}.`;
      },
    }),

    create_directory: tool({
      description: "Create a directory (and parents) in the workspace.",
      inputSchema: z.object({ path: z.string() }),
      async execute({ path: p }) {
        const fp = resolveInWorkspace(ctx.workspaceRoot, p, ctx.allowExternalFiles);
        if (!(await ensure(ctx, "create_directory", p))) {
          return "Declined by the user.";
        }
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(fp));
        return `Created directory ${p}.`;
      },
    }),

    move_file: tool({
      description: "Move or rename a file within the workspace.",
      inputSchema: z.object({ from: z.string(), to: z.string() }),
      async execute({ from, to }) {
        const fromUri = vscode.Uri.file(resolveInWorkspace(ctx.workspaceRoot, from, ctx.allowExternalFiles));
        const toUri = vscode.Uri.file(resolveInWorkspace(ctx.workspaceRoot, to, ctx.allowExternalFiles));
        if (!(await ensure(ctx, "move_file", `${from} -> ${to}`))) {
          return "Move declined by the user.";
        }
        await vscode.workspace.fs.rename(fromUri, toUri, { overwrite: false });
        ctx.trackFileChange?.(to, "moved", from);
        return `Moved ${from} -> ${to}.`;
      },
    }),

    list_directory: tool({
      description: "List entries in a workspace directory. Use '.' for the root.",
      inputSchema: z.object({ path: z.string() }),
      async execute({ path: p }) {
        const fp = resolveInWorkspace(ctx.workspaceRoot, p || ".", ctx.allowExternalFiles);
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(fp));
        if (entries.length === 0) {
          return "(empty)";
        }
        return entries
          .map(([n, t]) => (t === vscode.FileType.Directory ? `${n}/` : n))
          .sort()
          .join("\n");
      },
    }),

    // ---- Tiered search -------------------------------------------------
    find_files: tool({
      description: "Tier 1: find files by glob pattern, e.g. '**/*.ts'.",
      inputSchema: z.object({ glob: z.string() }),
      execute: ({ glob }) => searchFilenames(glob, ctx.workspaceRoot),
    }),

    search_text: tool({
      description: "Tier 1: keyword search across file contents. Returns file:line matches.",
      inputSchema: z.object({
        query: z.string(),
        include: z.string().optional().describe("Optional glob filter, e.g. '**/*.py'."),
      }),
      execute: ({ query, include }) =>
        searchKeyword(query, ctx.workspaceRoot, include ?? "**/*"),
    }),

    search_symbols: tool({
      description:
        "Tier 2: find code symbols (functions, classes, methods) by name using language servers.",
      inputSchema: z.object({ query: z.string() }),
      execute: ({ query }) => searchSymbols(query, ctx.workspaceRoot),
    }),

    search_semantic: tool({
      description:
        "Tier 3: semantic search over the embedding index. Best for 'where is X handled' style questions.",
      inputSchema: z.object({ query: z.string(), k: z.number().optional() }),
      execute: ({ query, k }) => searchSemantic(query, ctx.repoIndex, k ?? 8),
    }),

    index_repository: tool({
      description:
        "Build or rebuild the Tier 3 semantic embedding index over the repository. Run once before semantic search.",
      inputSchema: z.object({}),
      async execute() {
        const count = await ctx.repoIndex.build(ctx.workspaceRoot, ctx.onNote);
        return `Indexed ${count} chunks.`;
      },
    }),

    // ---- IDE context ---------------------------------------------------
    get_open_editors: tool({
      description: "List the files currently open in the editor.",
      inputSchema: z.object({}),
      async execute() {
        const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
        const paths = tabs
          .map((t) => (t.input as { uri?: vscode.Uri })?.uri)
          .filter((u): u is vscode.Uri => !!u)
          .map((u) => rel(ctx.workspaceRoot, u.fsPath));
        return paths.length ? [...new Set(paths)].join("\n") : "(no open editors)";
      },
    }),

    get_active_selection: tool({
      description: "Get the active editor's file path and currently selected text.",
      inputSchema: z.object({}),
      async execute() {
        const ed = vscode.window.activeTextEditor;
        if (!ed) {
          return "(no active editor)";
        }
        const file = rel(ctx.workspaceRoot, ed.document.uri.fsPath);
        const sel = ed.document.getText(ed.selection);
        return `file: ${file}\nselection:\n${sel || "(none)"}`;
      },
    }),

    get_diagnostics: tool({
      description: "Get current problems (errors/warnings) reported in the workspace.",
      inputSchema: z.object({ path: z.string().optional() }),
      async execute({ path: p }) {
        let diags = vscode.languages.getDiagnostics();
        if (p) {
          const fp = resolveInWorkspace(ctx.workspaceRoot, p, ctx.allowExternalFiles);
          diags = diags.filter(([uri]) => uri.fsPath === fp);
        }
        const lines: string[] = [];
        for (const [uri, list] of diags) {
          for (const d of list) {
            const sev = ["Error", "Warning", "Info", "Hint"][d.severity] ?? "Info";
            lines.push(
              `${rel(ctx.workspaceRoot, uri.fsPath)}:${d.range.start.line + 1} [${sev}] ${d.message}`
            );
          }
        }
        return lines.length ? lines.slice(0, 200).join("\n") : "(no problems)";
      },
    }),

    // ---- Exec & net ----------------------------------------------------
    run_command: tool({
      description:
        "Run a shell command in the workspace root. Requires user confirmation. Use for build/test/install/git.",
      inputSchema: z.object({ command: z.string() }),
      async execute({ command }) {
        if (!(await ensure(ctx, "run_command", command))) {
          return "Command declined by the user.";
        }
        console.log(`[Tool:run_command] Starting in ${ctx.workspaceRoot}: ${command}`);
        ctx.onNote?.(`Running command in ${ctx.workspaceRoot}: ${command}`);
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: ctx.workspaceRoot,
            timeout: 120_000,
            maxBuffer: 10 * 1024 * 1024,
          });
          const output = [stdout, stderr].filter(Boolean).join("\n").trim() || "(no output)";
          console.log(`[Tool:run_command] Completed in ${ctx.workspaceRoot}: ${command}`);
          ctx.onNote?.(`Command finished: ${command}`);
          return output;
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; message?: string };
          console.error(`[Tool:run_command] Failed in ${ctx.workspaceRoot}: ${command}`, err);
          ctx.onNote?.(`Command failed: ${command}`);
          return `Command failed.\n${[e.stdout, e.stderr, e.message].filter(Boolean).join("\n")}`;
        }
      },
    }),

    fetch_url: tool({
      description: "Fetch the text content of an HTTP(S) URL (for docs/reference).",
      inputSchema: z.object({ url: z.string().url() }),
      async execute({ url }) {
        const res = await fetch(url, { headers: { "User-Agent": "ai-agent-chat" } });
        const text = await res.text();
        const MAX = 20_000;
        return text.length > MAX ? text.slice(0, MAX) + "\n[...truncated]" : text;
      },
    }),

    open_browser_url: tool({
      description:
        "Open a URL in the configured VS Code preview browser. Use for local dev servers, docs, or generated files.",
      inputSchema: z.object({
        url: z.string().url(),
        target: z.enum(["auto", "integratedBrowser", "simpleBrowser", "external"]).optional(),
      }),
      async execute({ url, target }) {
        if (!ctx.openUrl) {
          return "Opening browser URLs is not available in this context.";
        }
        const uri = vscode.Uri.parse(url);
        const local = isLocalPreviewUri(uri);
        if (!local && ctx.permission !== "auto") {
          const allowed = await ctx.confirm("Open external URL?", url);
          if (!allowed) {
            return "Open URL declined by the user.";
          }
        }
        await ctx.openUrl(url, { target: isOpenTarget(target) ? target : undefined });
        return `Opened ${url}.`;
      },
    }),

    // ---- Self-improvement ---------------------------------------------
    remember: tool({
      description:
        "Save a durable fact or user preference to long-term memory (.agentchat/memory.md). Use for things that should persist across sessions.",
      inputSchema: z.object({ note: z.string() }),
      async execute({ note }) {
        await ctx.memory.append(note);
        return "Saved to memory.";
      },
    }),

    create_skill: tool({
      description:
        "Create or update a reusable skill (instructions) in .agentchat/skills. Use to capture a repeatable workflow so it can be reused later.",
      inputSchema: z.object({
        name: z.string(),
        description: z.string().optional(),
        body: z.string().describe("The skill instructions in markdown."),
        alwaysApply: z.boolean().optional(),
      }),
      async execute({ name, description, body, alwaysApply }) {
        await ctx.skills.save({ name, description, body, alwaysApply });
        return `Saved skill '${name}'.`;
      },
    }),

    delegate: tool({
      description:
        "Delegate a self-contained subtask to a specialist sub-agent. Returns only the sub-agent's final result; its intermediate tool calls stay out of this conversation to save tokens. Use for large, isolated explorations or specialized work.",
      inputSchema: z.object({
        agentId: z.string().describe("Id of an allowed sub-agent."),
        task: z
          .string()
          .describe("A complete, self-contained description of the subtask, including needed context."),
      }),
      async execute({ agentId, task }) {
        if (!ctx.delegate) {
          return "Delegation is not available in this context.";
        }
        if (ctx.allowedSubAgents && !ctx.allowedSubAgents.includes(agentId)) {
          return `Agent '${agentId}' is not an allowed sub-agent. Allowed: ${
            ctx.allowedSubAgents.join(", ") || "none"
          }.`;
        }
        return ctx.delegate(agentId, task);
      },
    }),

    // ---- Git tools -------------------------------------------------------
    git_status: tool({
      description: "Show the working tree status in porcelain format.",
      inputSchema: z.object({}),
      async execute() {
        try {
          const { stdout } = await execAsync("git status --porcelain", {
            cwd: ctx.workspaceRoot,
            timeout: 10_000,
          });
          return stdout.trim() || "(clean working tree)";
        } catch (err: unknown) {
          const e = err as { stderr?: string; message?: string };
          return `git status failed: ${e.stderr || e.message || "unknown error"}`;
        }
      },
    }),

    git_diff: tool({
      description: "Show file differences. Use unstaged for working-tree changes, staged for index changes.",
      inputSchema: z.object({
        staged: z.boolean().optional().describe("If true, show staged diff (git diff --cached)."),
        path: z.string().optional().describe("Optional file path to limit diff."),
      }),
      async execute({ staged, path: p }) {
        try {
          const args = ["diff"];
          if (staged) args.push("--cached");
          if (p) args.push("--", p);
          const { stdout } = await execAsync(`git ${args.join(" ")}`, {
            cwd: ctx.workspaceRoot,
            timeout: 10_000,
            maxBuffer: 5 * 1024 * 1024,
          });
          const output = stdout.trim();
          if (!output) return staged ? "(no staged changes)" : "(no unstaged changes)";
          const MAX = 60_000;
          return output.length > MAX
            ? output.slice(0, MAX) + `\n[...truncated ${output.length - MAX} chars]`
            : output;
        } catch (err: unknown) {
          const e = err as { stderr?: string; message?: string };
          return `git diff failed: ${e.stderr || e.message || "unknown error"}`;
        }
      },
    }),

    git_log: tool({
      description: "Show recent commit history.",
      inputSchema: z.object({
        count: z.number().optional().describe("Number of commits to show (default 15)."),
      }),
      async execute({ count }) {
        try {
          const n = count ?? 15;
          const { stdout } = await execAsync(
            `git log --oneline -n ${n}`,
            { cwd: ctx.workspaceRoot, timeout: 10_000 }
          );
          return stdout.trim() || "(no commits)";
        } catch (err: unknown) {
          const e = err as { stderr?: string; message?: string };
          return `git log failed: ${e.stderr || e.message || "unknown error"}`;
        }
      },
    }),

    git_stage: tool({
      description: "Stage files for the next commit (git add).",
      inputSchema: z.object({
        files: z.array(z.string()).describe("List of workspace-relative file paths to stage."),
      }),
      async execute({ files }) {
        if (!(await ensure(ctx, "git_stage", files.join(", ")))) {
          return "Stage declined by the user.";
        }
        try {
          const paths = files.map((f) => `"${f}"`).join(" ");
          const { stdout, stderr } = await execAsync(`git add ${paths}`, {
            cwd: ctx.workspaceRoot,
            timeout: 10_000,
          });
          return `Staged ${files.length} file(s).${stdout ? "\n" + stdout : ""}${stderr ? "\n" + stderr : ""}`;
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; message?: string };
          return `git add failed: ${[e.stdout, e.stderr, e.message].filter(Boolean).join("\n")}`;
        }
      },
    }),

    git_unstage: tool({
      description: "Unstage files from the index (git restore --staged).",
      inputSchema: z.object({
        files: z.array(z.string()).describe("List of workspace-relative file paths to unstage."),
      }),
      async execute({ files }) {
        if (!(await ensure(ctx, "git_unstage", files.join(", ")))) {
          return "Unstage declined by the user.";
        }
        try {
          const paths = files.map((f) => `"${f}"`).join(" ");
          const { stdout, stderr } = await execAsync(`git restore --staged ${paths}`, {
            cwd: ctx.workspaceRoot,
            timeout: 10_000,
          });
          return `Unstaged ${files.length} file(s).${stdout ? "\n" + stdout : ""}${stderr ? "\n" + stderr : ""}`;
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; message?: string };
          return `git restore --staged failed: ${[e.stdout, e.stderr, e.message].filter(Boolean).join("\n")}`;
        }
      },
    }),

    git_commit: tool({
      description: "Create a new commit with a message.",
      inputSchema: z.object({
        message: z.string().describe("Commit message."),
      }),
      async execute({ message }) {
        if (!(await ensure(ctx, "git_commit", message))) {
          return "Commit declined by the user.";
        }
        try {
          const { stdout, stderr } = await execAsync(
            `git commit -m ${JSON.stringify(message)}`,
            { cwd: ctx.workspaceRoot, timeout: 15_000 }
          );
          return [stdout, stderr].filter(Boolean).join("\n").trim() || "Commit created.";
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; message?: string };
          return `git commit failed: ${[e.stdout, e.stderr, e.message].filter(Boolean).join("\n")}`;
        }
      },
    }),

    git_branch: tool({
      description: "List, create, or switch git branches.",
      inputSchema: z.object({
        name: z.string().optional().describe("Branch name to create or switch to. Omit to list branches."),
        create: z.boolean().optional().describe("If true, create a new branch (git checkout -b)."),
      }),
      async execute({ name, create }) {
        if (!name) {
          try {
            const { stdout } = await execAsync("git branch --list", {
              cwd: ctx.workspaceRoot,
              timeout: 10_000,
            });
            return stdout.trim() || "(no branches)";
          } catch (err: unknown) {
            const e = err as { stderr?: string; message?: string };
            return `git branch failed: ${e.stderr || e.message || "unknown error"}`;
          }
        }
        if (!(await ensure(ctx, "git_branch", create ? `create ${name}` : `switch to ${name}`))) {
          return "Branch operation declined by the user.";
        }
        try {
          const cmd = create ? `git checkout -b ${name}` : `git checkout ${name}`;
          const { stdout, stderr } = await execAsync(cmd, {
            cwd: ctx.workspaceRoot,
            timeout: 10_000,
          });
          return [stdout, stderr].filter(Boolean).join("\n").trim() || `Switched to branch '${name}'.`;
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; message?: string };
          return `git branch failed: ${[e.stdout, e.stderr, e.message].filter(Boolean).join("\n")}`;
        }
      },
    }),

    git_push: tool({
      description: "Push commits to the remote repository.",
      inputSchema: z.object({
        remote: z.string().optional().describe("Remote name (default: origin)."),
        branch: z.string().optional().describe("Branch name (default: current branch)."),
      }),
      async execute({ remote, branch }) {
        const target = `${remote || "origin"} ${branch || "HEAD"}`;
        if (!(await ensure(ctx, "git_push", target))) {
          return "Push declined by the user.";
        }
        try {
          const { stdout, stderr } = await execAsync(
            `git push ${remote || "origin"} ${branch || "HEAD"}`,
            { cwd: ctx.workspaceRoot, timeout: 60_000 }
          );
          return [stdout, stderr].filter(Boolean).join("\n").trim() || "Push completed.";
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; message?: string };
          return `git push failed: ${[e.stdout, e.stderr, e.message].filter(Boolean).join("\n")}`;
        }
      },
    }),

    git_pull: tool({
      description: "Pull commits from the remote repository.",
      inputSchema: z.object({
        remote: z.string().optional().describe("Remote name (default: origin)."),
        branch: z.string().optional().describe("Branch name (default: current branch)."),
      }),
      async execute({ remote, branch }) {
        const target = `${remote || "origin"} ${branch || ""}`.trim();
        if (!(await ensure(ctx, "git_pull", target))) {
          return "Pull declined by the user.";
        }
        try {
          const { stdout, stderr } = await execAsync(
            `git pull ${remote || "origin"} ${branch || ""}`.trim(),
            { cwd: ctx.workspaceRoot, timeout: 60_000 }
          );
          return [stdout, stderr].filter(Boolean).join("\n").trim() || "Pull completed.";
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; message?: string };
          return `git pull failed: ${[e.stdout, e.stderr, e.message].filter(Boolean).join("\n")}`;
        }
      },
    }),
  };

  // The delegate tool only exists when the context can actually run sub-agents.
  if (!(ctx.delegate && ctx.allowedSubAgents && ctx.allowedSubAgents.length > 0)) {
    delete all.delegate;
  }

  if (ctx.permission === "readonly") {
    for (const name of MUTATING_TOOLS) {
      delete all[name];
    }
  }

  if (allowed === "all") {
    return all;
  }
  const filtered: ToolSet = {};
  for (const name of allowed) {
    if (all[name]) {
      filtered[name] = all[name];
    }
  }
  return filtered;
}

/** Static catalog of built-in tools for the agent-config UI. */
export const TOOL_CATALOG: { name: string; description: string; mutating: boolean }[] = [
  { name: "read_file", description: "Read a file", mutating: false },
  { name: "write_file", description: "Create/overwrite a file", mutating: true },
  { name: "edit_file", description: "Targeted edit of a file", mutating: true },
  { name: "delete_file", description: "Delete a file/dir", mutating: true },
  { name: "create_directory", description: "Create a directory", mutating: true },
  { name: "move_file", description: "Move/rename a file", mutating: true },
  { name: "list_directory", description: "List a directory", mutating: false },
  { name: "find_files", description: "Tier 1: find files by glob", mutating: false },
  { name: "search_text", description: "Tier 1: keyword search", mutating: false },
  { name: "search_symbols", description: "Tier 2: symbol search", mutating: false },
  { name: "search_semantic", description: "Tier 3: semantic search", mutating: false },
  { name: "index_repository", description: "Build the semantic index", mutating: false },
  { name: "get_open_editors", description: "List open editors", mutating: false },
  { name: "get_active_selection", description: "Active editor selection", mutating: false },
  { name: "get_diagnostics", description: "Problems/diagnostics", mutating: false },
  { name: "run_command", description: "Run a shell command", mutating: true },
  { name: "fetch_url", description: "Fetch a URL", mutating: false },
  { name: "open_browser_url", description: "Open a URL in the preview browser", mutating: false },
  { name: "remember", description: "Save to long-term memory", mutating: false },
  { name: "create_skill", description: "Create/update a skill", mutating: false },
  { name: "delegate", description: "Delegate a subtask to a sub-agent", mutating: false },
  { name: "git_status", description: "Show working tree status", mutating: false },
  { name: "git_diff", description: "Show unstaged/staged diff", mutating: false },
  { name: "git_log", description: "Show recent commit history", mutating: false },
  { name: "git_stage", description: "Stage files (git add)", mutating: true },
  { name: "git_unstage", description: "Unstage files (git restore --staged)", mutating: true },
  { name: "git_commit", description: "Create a commit", mutating: true },
  { name: "git_branch", description: "List/create/switch branches", mutating: true },
  { name: "git_push", description: "Push to remote", mutating: true },
  { name: "git_pull", description: "Pull from remote", mutating: true },
];
