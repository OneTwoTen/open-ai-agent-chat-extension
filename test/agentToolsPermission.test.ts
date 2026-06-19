import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildTools } from "../src/agent/tools";
import type { ToolContext } from "../src/agent/agent";

describe("Agent Tools Permission Logic", () => {
  let mockCtx: ToolContext;

  beforeEach(() => {
    mockCtx = {
      permission: "ask",
      confirm: vi.fn(async () => true),
      previewEdit: vi.fn(async () => true),
      // Add other necessary mock properties
    } as any;
  });

  describe("Confirmation Logic (ensure)", () => {
    it("should always require confirmation for destructive tools in 'ask' mode", async () => {
      mockCtx.permission = "ask";
      const tools = buildTools(mockCtx, "all");
      
      // We need to trigger a tool that calls 'ensure'
      // Since 'ensure' is internal, we test it via the tool execution
      await tools.run_command({ command: "ls" });
      expect(mockCtx.confirm).toHaveBeenCalled();
    });

    it("should allow non-destructive tools without confirmation in 'auto' mode", async () => {
      mockCtx.permission = "auto";
      const tools = buildTools(mockCtx, "all");
      
      await tools.read_file({ path: "test.txt" });
      expect(mockCtx.confirm).not.toHaveBeenCalled();
    });

    it("should NOW allow destructive tools without confirmation in 'auto' mode", async () => {
      mockCtx.permission = "auto";
      const tools = buildTools(mockCtx, "all");
      
      // Test run_command
      await tools.run_command({ command: "rm -rf /" });
      // Test delete_file
      await tools.delete_file({ path: "important.txt" });
      
      expect(mockCtx.confirm).not.toHaveBeenCalled();
    });
  });

  describe("Preview Edit Logic", () => {
    it("should request preview edit in 'ask' or 'confirm' mode", async () => {
      mockCtx.permission = "confirm";
      const tools = buildTools(mockCtx, "all");
      
      await tools.write_file({ path: "test.txt", content: "hello" });
      expect(mockCtx.previewEdit).toHaveBeenCalled();
    });

    it("should skip preview edit in 'auto' mode", async () => {
      mockCtx.permission = "auto";
      const tools = buildTools(mockCtx, "all");
      
      await tools.write_file({ path: "test.txt", content: "hello" });
      await tools.edit_file({ path: "test.txt", oldText: "a", newText: "b" });
      
      expect(mockCtx.previewEdit).not.toHaveBeenCalled();
    });
  });
});
