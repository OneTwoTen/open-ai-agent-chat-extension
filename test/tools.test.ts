import { describe, expect, it } from "vitest";
import { buildTools, TOOL_CATALOG, ToolContext } from "../src/agent/tools";

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    workspaceRoot: "/tmp/ws",
    permission: "ask",
    confirm: async () => true,
    // Not exercised by these tests (tool bodies are never executed):
    repoIndex: {} as unknown as ToolContext["repoIndex"],
    memory: {} as unknown as ToolContext["memory"],
    skills: {} as unknown as ToolContext["skills"],
    ...overrides,
  };
}

describe("buildTools – delegate gating", () => {
  it("omits delegate when no delegate fn is provided", () => {
    const tools = buildTools(makeCtx({ allowedSubAgents: ["coder"] }), "all");
    expect(tools.delegate).toBeUndefined();
  });

  it("omits delegate when there are no allowed sub-agents", () => {
    const tools = buildTools(
      makeCtx({ delegate: async () => "ok", allowedSubAgents: [] }),
      "all"
    );
    expect(tools.delegate).toBeUndefined();
  });

  it("includes delegate when a fn and allowed sub-agents are present", () => {
    const tools = buildTools(
      makeCtx({ delegate: async () => "ok", allowedSubAgents: ["coder"] }),
      "all"
    );
    expect(tools.delegate).toBeDefined();
  });
});

describe("buildTools – permission gating", () => {
  it("removes mutating tools in readonly mode", () => {
    const tools = buildTools(makeCtx({ permission: "readonly" }), "all");
    expect(tools.write_file).toBeUndefined();
    expect(tools.edit_file).toBeUndefined();
    expect(tools.delete_file).toBeUndefined();
    expect(tools.run_command).toBeUndefined();
    // Read-only tools remain:
    expect(tools.read_file).toBeDefined();
    expect(tools.search_text).toBeDefined();
  });

  it("keeps mutating tools in ask/auto mode", () => {
    expect(buildTools(makeCtx({ permission: "ask" }), "all").write_file).toBeDefined();
    expect(buildTools(makeCtx({ permission: "auto" }), "all").run_command).toBeDefined();
  });

  it("emits notes when run_command starts and finishes", async () => {
    const notes: string[] = [];
    const command = "node -e \"process.stdout.write('ok')\"";
    const tools = buildTools(
      makeCtx({
        workspaceRoot: process.cwd(),
        confirm: async () => true,
        onNote: (msg) => notes.push(msg),
      }),
      "all",
    );

    const result = await (tools.run_command as any).execute({ command });

    expect(result).toBe("ok");
    expect(notes).toEqual([
      `Running command in ${process.cwd()}: ${command}`,
      `Command finished: ${command}`,
    ]);
  });
});

describe("buildTools – allow-list filtering", () => {
  it("returns only the named tools", () => {
    const tools = buildTools(makeCtx(), ["read_file", "search_text"]);
    expect(Object.keys(tools).sort()).toEqual(["read_file", "search_text"]);
  });

  it("intersects allow-list with readonly removal", () => {
    const tools = buildTools(makeCtx({ permission: "readonly" }), ["read_file", "write_file"]);
    expect(Object.keys(tools)).toEqual(["read_file"]);
  });
});

describe("buildTools - open_browser_url", () => {
  it("opens localhost URLs without confirmation", async () => {
    const opened: string[] = [];
    let confirmCalls = 0;
    const tools = buildTools(
      makeCtx({
        confirm: async () => {
          confirmCalls++;
          return true;
        },
        openUrl: async (url) => {
          opened.push(url);
        },
      }),
      "all",
    );

    const result = await (tools.open_browser_url as any).execute({
      url: "http://localhost:5173",
    });

    expect(result).toBe("Opened http://localhost:5173.");
    expect(opened).toEqual(["http://localhost:5173"]);
    expect(confirmCalls).toBe(0);
  });

  it("asks before opening public URLs outside auto permission", async () => {
    let detail = "";
    const tools = buildTools(
      makeCtx({
        permission: "ask",
        confirm: async (_title, d) => {
          detail = d;
          return false;
        },
        openUrl: async () => {
          throw new Error("should not open");
        },
      }),
      "all",
    );

    const result = await (tools.open_browser_url as any).execute({
      url: "https://example.com",
    });

    expect(result).toBe("Open URL declined by the user.");
    expect(detail).toBe("https://example.com");
  });
});

describe("buildTools - diff preview edits", () => {
  it("routes write_file through previewEdit before writing", async () => {
    let preview: { path: string; original: string; updated: string } | undefined;
    const tools = buildTools(
      makeCtx({
        permission: "ask",
        previewEdit: async (path, original, updated) => {
          preview = { path, original, updated };
          return true;
        },
      }),
      "all"
    );

    const result = await (tools.write_file as any).execute({
      path: "src/example.ts",
      content: "next",
    });

    expect(preview).toEqual({ path: "src/example.ts", original: "", updated: "next" });
    expect(result).toBe("Wrote 4 chars to src/example.ts.");
  });

  it("does not write when previewEdit rejects an edit_file change", async () => {
    const tools = buildTools(
      makeCtx({
        permission: "ask",
        previewEdit: async () => false,
      }),
      "all"
    );

    const result = await (tools.edit_file as any).execute({
      path: "src/example.ts",
      oldText: "",
      newText: "next",
    });

    expect(result).toBe("Edit rejected by the user.");
  });
});

describe("TOOL_CATALOG", () => {
  it("flags mutating tools correctly", () => {
    const byName = Object.fromEntries(TOOL_CATALOG.map((t) => [t.name, t]));
    expect(byName.write_file.mutating).toBe(true);
    expect(byName.run_command.mutating).toBe(true);
    expect(byName.read_file.mutating).toBe(false);
    expect(byName.open_browser_url.mutating).toBe(false);
    expect(byName.search_semantic.mutating).toBe(false);
  });

  it("lists the delegate tool", () => {
    expect(TOOL_CATALOG.some((t) => t.name === "delegate")).toBe(true);
  });
});
