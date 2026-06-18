import type { ModelMessage } from "ai";
import * as vscode from "vscode";
import { SessionSummary, TranscriptItem } from "./shared/protocol";

interface StoredSession {
  id: string;
  title: string;
  updatedAt: number;
  transcript: TranscriptItem[];
  history: ModelMessage[];
}

/**
 * Persists chat sessions as JSON files under the extension's storage dir,
 * with a lightweight index for fast listing.
 */
export class SessionStore {
  private readonly dir: vscode.Uri;
  private readonly indexFile: vscode.Uri;

  constructor(baseStorage: vscode.Uri) {
    this.dir = vscode.Uri.joinPath(baseStorage, "sessions");
    this.indexFile = vscode.Uri.joinPath(this.dir, "index.json");
  }

  private async readIndex(): Promise<SessionSummary[]> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.indexFile);
      return JSON.parse(Buffer.from(bytes).toString("utf8")) as SessionSummary[];
    } catch {
      return [];
    }
  }

  private async writeIndex(list: SessionSummary[]): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.dir);
    await vscode.workspace.fs.writeFile(
      this.indexFile,
      Buffer.from(JSON.stringify(list, null, 2), "utf8")
    );
  }

  async list(): Promise<SessionSummary[]> {
    const list = await this.readIndex();
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string): Promise<StoredSession | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.fileFor(id));
      return JSON.parse(Buffer.from(bytes).toString("utf8")) as StoredSession;
    } catch {
      return undefined;
    }
  }

  async save(session: StoredSession): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.dir);
    await vscode.workspace.fs.writeFile(
      this.fileFor(session.id),
      Buffer.from(JSON.stringify(session), "utf8")
    );
    const index = await this.readIndex();
    const summary: SessionSummary = {
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
    };
    const existing = index.findIndex((s) => s.id === session.id);
    if (existing >= 0) {
      index[existing] = summary;
    } else {
      index.push(summary);
    }
    await this.writeIndex(index);
  }

  async delete(id: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(this.fileFor(id));
    } catch {
      // already gone
    }
    const index = (await this.readIndex()).filter((s) => s.id !== id);
    await this.writeIndex(index);
  }

  newId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private fileFor(id: string): vscode.Uri {
    return vscode.Uri.joinPath(this.dir, `${id}.json`);
  }
}

/** Derive a short title from the first user message. */
export function titleFrom(text: string): string {
  const firstLine = text.trim().split("\n")[0];
  return firstLine.length > 50 ? firstLine.slice(0, 50) + "…" : firstLine || "New chat";
}
