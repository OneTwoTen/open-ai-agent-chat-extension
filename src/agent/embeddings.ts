import { cosineSimilarity, embed, embedMany, type EmbeddingModel } from "ai";
import * as path from "path";
import * as vscode from "vscode";

interface IndexEntry {
  file: string;
  start: number;
  text: string;
  embedding: number[];
}

interface PersistedIndex {
  version: number;
  model: string;
  entries: IndexEntry[];
}

const INDEX_VERSION = 1;
const MAX_FILE_BYTES = 200_000;
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 150;
const EMBED_BATCH = 96;

/**
 * A persisted repository index backed by text embeddings.
 * Powers Tier 3 (semantic) search. Stored as JSON in the extension's
 * workspace storage so it survives reloads.
 */
export class RepoIndex {
  private entries: IndexEntry[] = [];
  private loaded = false;

  constructor(
    private readonly storageFile: vscode.Uri,
    private readonly getModel: () => Promise<EmbeddingModel>
  ) {}

  get size(): number {
    return this.entries.length;
  }

  /** Load a previously persisted index from disk, if present. */
  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(this.storageFile);
      const data = JSON.parse(Buffer.from(bytes).toString("utf8")) as PersistedIndex;
      if (data.version === INDEX_VERSION) {
        this.entries = data.entries;
      }
    } catch {
      // No index yet.
    }
    this.loaded = true;
  }

  private async save(modelId: string): Promise<void> {
    const data: PersistedIndex = {
      version: INDEX_VERSION,
      model: modelId,
      entries: this.entries,
    };
    await vscode.workspace.fs.writeFile(
      this.storageFile,
      Buffer.from(JSON.stringify(data), "utf8")
    );
  }

  /**
   * (Re)build the index over workspace files.
   * Reports coarse progress via the optional callback.
   */
  async build(
    workspaceRoot: string,
    onProgress?: (msg: string) => void
  ): Promise<number> {
    const model = await this.getModel();
    const files = await vscode.workspace.findFiles(
      "**/*",
      "{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/*.{png,jpg,jpeg,gif,svg,ico,pdf,zip,lock,bin,exe,dll,woff,woff2,ttf}}",
      4000
    );

    const chunks: Array<{ file: string; start: number; text: string }> = [];
    for (const file of files) {
      try {
        const stat = await vscode.workspace.fs.stat(file);
        if (stat.size > MAX_FILE_BYTES) {
          continue;
        }
        const bytes = await vscode.workspace.fs.readFile(file);
        const text = Buffer.from(bytes).toString("utf8");
        if (text.includes("\u0000")) {
          continue; // binary
        }
        const rel = path.relative(workspaceRoot, file.fsPath).replace(/\\/g, "/");
        for (let i = 0; i < text.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
          const slice = text.slice(i, i + CHUNK_SIZE);
          if (slice.trim().length > 0) {
            chunks.push({ file: rel, start: i, text: slice });
          }
        }
      } catch {
        // skip
      }
    }

    onProgress?.(`Embedding ${chunks.length} chunks from ${files.length} files…`);
    this.entries = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const { embeddings } = await embedMany({
        model,
        values: batch.map((c) => c.text),
      });
      batch.forEach((c, j) => {
        this.entries.push({ ...c, embedding: embeddings[j] });
      });
      onProgress?.(`Indexed ${Math.min(i + EMBED_BATCH, chunks.length)}/${chunks.length}…`);
    }

    this.loaded = true;
    await this.save("embeddings");
    return this.entries.length;
  }

  /** Semantic top-k search. Returns matches sorted by similarity. */
  async query(
    query: string,
    k = 8
  ): Promise<Array<{ file: string; start: number; text: string; score: number }>> {
    await this.load();
    if (this.entries.length === 0) {
      return [];
    }
    const model = await this.getModel();
    const { embedding } = await embed({ model, value: query });
    return this.entries
      .map((e) => ({
        file: e.file,
        start: e.start,
        text: e.text,
        score: cosineSimilarity(embedding, e.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}
