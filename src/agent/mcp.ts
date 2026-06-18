import { dynamicTool, jsonSchema, type ToolSet } from "ai";
import * as path from "path";
import * as vscode from "vscode";
import { McpServerConfig, McpServerStatus, McpTransport } from "../shared/protocol";
import { resolveAgentchatDir } from "./dataPath";

interface Conn {
  config: McpServerConfig;
  client?: { callTool: (a: unknown) => Promise<unknown>; close: () => Promise<void> };
  tools: ToolSet;
  status: "connected" | "disconnected" | "error";
  toolNames: string[];
  error?: string;
}

/**
 * Connects to Model Context Protocol servers and exposes their tools as
 * AI SDK tools. Config lives in `.agentchat/mcp.json`; the loader also
 * accepts the `mcpServers` map format used by Claude/Cursor for portability.
 */
export class McpManager {
  private readonly file: vscode.Uri;
  private readonly conns = new Map<string, Conn>();

  constructor(workspaceRoot: string) {
    this.file = vscode.Uri.file(path.join(resolveAgentchatDir(workspaceRoot), "mcp.json"));
  }

  async loadConfig(): Promise<McpServerConfig[]> {
    let raw: Record<string, unknown>;
    try {
      const bytes = await vscode.workspace.fs.readFile(this.file);
      raw = JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
      return [];
    }
    if (Array.isArray((raw as { servers?: unknown }).servers)) {
      return (raw as { servers: McpServerConfig[] }).servers;
    }
    // Compatibility: { "mcpServers": { id: { command, args, url } } }
    const map = (raw.mcpServers ?? raw) as Record<string, Record<string, unknown>>;
    const out: McpServerConfig[] = [];
    for (const [id, v] of Object.entries(map)) {
      if (typeof v !== "object" || v === null) {
        continue;
      }
      const url = v.url as string | undefined;
      const transport: McpTransport = v.command ? "stdio" : url?.includes("/sse") ? "sse" : url ? "http" : "stdio";
      out.push({
        id,
        transport,
        command: v.command as string | undefined,
        args: (v.args as string[] | undefined) ?? [],
        url,
        enabled: v.enabled !== false,
      });
    }
    return out;
  }

  async saveConfig(servers: McpServerConfig[]): Promise<void> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.file, ".."));
    await vscode.workspace.fs.writeFile(
      this.file,
      Buffer.from(JSON.stringify({ servers }, null, 2), "utf8")
    );
  }

  async saveServer(server: McpServerConfig): Promise<void> {
    const list = await this.loadConfig();
    const idx = list.findIndex((s) => s.id === server.id);
    if (idx >= 0) {
      list[idx] = server;
    } else {
      list.push(server);
    }
    await this.saveConfig(list);
  }

  async deleteServer(id: string): Promise<void> {
    const list = (await this.loadConfig()).filter((s) => s.id !== id);
    await this.saveConfig(list);
    await this.closeConn(id);
    this.conns.delete(id);
  }

  /** (Re)connect all configured servers. */
  async connectAll(): Promise<void> {
    const configs = await this.loadConfig();
    const ids = new Set(configs.map((c) => c.id));
    for (const id of [...this.conns.keys()]) {
      if (!ids.has(id)) {
        await this.closeConn(id);
        this.conns.delete(id);
      }
    }
    for (const config of configs) {
      await this.closeConn(config.id);
      if (!config.enabled) {
        this.conns.set(config.id, { config, tools: {}, status: "disconnected", toolNames: [] });
        continue;
      }
      await this.connect(config);
    }
  }

  private async connect(config: McpServerConfig): Promise<void> {
    try {
      const { Client } = (await import(
        "@modelcontextprotocol/sdk/client/index.js"
      )) as unknown as { Client: new (a: unknown, b: unknown) => any };

      const transport = await this.buildTransport(config);
      const client = new Client(
        { name: "ai-agent-chat", version: "0.0.1" },
        { capabilities: {} }
      );
      await client.connect(transport);
      const list = await client.listTools();

      const tools: ToolSet = {};
      const toolNames: string[] = [];
      for (const t of list.tools ?? []) {
        const key = `${config.id}_${t.name}`;
        toolNames.push(t.name);
        tools[key] = dynamicTool({
          description: `[MCP:${config.id}] ${t.description ?? t.name}`,
          inputSchema: jsonSchema((t.inputSchema as object) ?? { type: "object", properties: {} }),
          execute: async (args: unknown) => {
            const res = await client.callTool({
              name: t.name,
              arguments: (args as Record<string, unknown>) ?? {},
            });
            return mcpResultToText(res);
          },
        });
      }
      this.conns.set(config.id, { config, client, tools, status: "connected", toolNames });
    } catch (err: unknown) {
      this.conns.set(config.id, {
        config,
        tools: {},
        status: "error",
        toolNames: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async buildTransport(config: McpServerConfig): Promise<unknown> {
    if (config.transport === "stdio") {
      const { StdioClientTransport } = (await import(
        "@modelcontextprotocol/sdk/client/stdio.js"
      )) as unknown as { StdioClientTransport: new (a: unknown) => unknown };
      return new StdioClientTransport({ command: config.command ?? "", args: config.args ?? [] });
    }
    if (config.transport === "sse") {
      const { SSEClientTransport } = (await import(
        "@modelcontextprotocol/sdk/client/sse.js"
      )) as unknown as { SSEClientTransport: new (a: URL) => unknown };
      return new SSEClientTransport(new URL(config.url ?? ""));
    }
    const { StreamableHTTPClientTransport } = (await import(
      "@modelcontextprotocol/sdk/client/streamableHttp.js"
    )) as unknown as { StreamableHTTPClientTransport: new (a: URL) => unknown };
    return new StreamableHTTPClientTransport(new URL(config.url ?? ""));
  }

  /** Merged tools from all connected servers, ready for streamText. */
  getTools(): ToolSet {
    const merged: ToolSet = {};
    for (const conn of this.conns.values()) {
      if (conn.status === "connected") {
        Object.assign(merged, conn.tools);
      }
    }
    return merged;
  }

  getStatus(): McpServerStatus[] {
    return [...this.conns.values()].map((c) => ({
      id: c.config.id,
      transport: c.config.transport,
      enabled: c.config.enabled,
      status: c.status,
      toolCount: c.toolNames.length,
      tools: c.toolNames,
      error: c.error,
    }));
  }

  private async closeConn(id: string): Promise<void> {
    const conn = this.conns.get(id);
    try {
      await conn?.client?.close();
    } catch {
      // ignore
    }
  }

  async disposeAll(): Promise<void> {
    for (const id of this.conns.keys()) {
      await this.closeConn(id);
    }
    this.conns.clear();
  }
}

function mcpResultToText(res: unknown): string {
  const r = res as { content?: Array<{ type: string; text?: string }> };
  if (Array.isArray(r?.content)) {
    return r.content
      .map((c) => (c.type === "text" ? c.text ?? "" : JSON.stringify(c)))
      .join("\n");
  }
  return JSON.stringify(res);
}
