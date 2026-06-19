import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildTools, type ToolContext } from "../src/agent/tools";

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    workspaceRoot: "/tmp/ws",
    permission: "ask",
    allowExternalFiles: false,
    confirm: async () => true,
    previewEdit: async () => true,
    repoIndex: {} as unknown as ToolContext["repoIndex"],
    memory: {} as unknown as ToolContext["memory"],
    skills: {} as unknown as ToolContext["skills"],
    ...overrides,
  };
}

describe("Agent Tools Permission Logic", () => {
  describe("Confirmation Logic (ensure)", () => {
    it("should always require confirmation for destructive tools in 'ask' mode", async () => {
      const ctx = makeCtx({ permission: "ask", confirm: vi.fn(async () => true) });
      const tools = buildTools(ctx, "all");
      
      // run_command is destructive, should require confirmation in 'ask' mode
      await (tools.run_command as any).execute({ command: "echo test" });
      expect(ctx.confirm).toHaveBeenCalled();
    });

    it("should allow non-destructive tools without confirmation in 'auto' mode", async () => {
      const ctx = makeCtx({ permission: "auto", confirm: vi.fn(async () => true) });
      const tools = buildTools(ctx, "all");
      
      // read_file is non-destructive, should not require confirmation in 'auto' mode
      await (tools.read_file as any).execute({ path: "test.txt" });
      expect(ctx.confirm).not.toHaveBeenCalled();
    });

    it("should allow destructive tools without confirmation in 'auto' mode", async () => {
      const ctx = makeCtx({ permission: "auto", confirm: vi.fn(async () => true) });
      const tools = buildTools(ctx, "all");
      
      // run_command is destructive but auto mode allows without confirm
      await (tools.run_command as any).execute({ command: "echo test" });
      // delete_file also destructive
      await (tools.delete_file as any).execute({ path: "important.txt" });
      
      expect(ctx.confirm).not.toHaveBeenCalled();
    });
  });

  describe("Preview Edit Logic", () => {
    it("should request preview edit in 'ask' mode", async () => {
      const ctx = makeCtx({
        permission: "ask",
        previewEdit: vi.fn(async () => true),
      });
      const tools = buildTools(ctx, "all");
      
      await (tools.write_file as any).execute({ path: "test.txt", content: "hello" });
      expect(ctx.previewEdit).toHaveBeenCalled();
    });

    it("should skip preview edit in 'auto' mode", async () => {
      const ctx = makeCtx({
        permission: "auto",
        previewEdit: vi.fn(async () => true),
      });
      const tools = buildTools(ctx, "all");
      
      await (tools.write_file as any).execute({ path: "test.txt", content: "hello" });
      await (tools.edit_file as any).execute({ path: "test.txt", oldText: "a", newText: "b" });
      
      expect(ctx.previewEdit).not.toHaveBeenCalled();
    });
  });
});
