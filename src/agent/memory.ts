import * as path from "path";
import * as vscode from "vscode";

const MAX_MEMORY_CHARS = 6000;

/**
 * A simple, human-readable persistent memory stored at
 * .agentchat/memory.md. The agent reads it at the start of every turn and
 * can append durable facts/preferences to it, enabling self-improvement
 * across sessions.
 */
export class MemoryStore {
  private readonly file: vscode.Uri;

  constructor(workspaceRoot: string) {
    this.file = vscode.Uri.file(path.join(workspaceRoot, ".agentchat", "memory.md"));
  }

  async read(): Promise<string> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.file);
      const text = Buffer.from(bytes).toString("utf8").trim();
      return text.length > MAX_MEMORY_CHARS
        ? text.slice(text.length - MAX_MEMORY_CHARS)
        : text;
    } catch {
      return "";
    }
  }

  /** Append a durable note as a bullet with a timestamp. */
  async append(note: string): Promise<void> {
    const dir = vscode.Uri.joinPath(this.file, "..");
    await vscode.workspace.fs.createDirectory(dir);
    const existing = (await this.read()) || "# Agent Memory\n";
    const stamp = new Date().toISOString().slice(0, 10);
    const updated = `${existing.trimEnd()}\n- (${stamp}) ${note.trim()}\n`;
    await vscode.workspace.fs.writeFile(this.file, Buffer.from(updated, "utf8"));
  }
}
