import { Box, Code, Group, Loader, Paper, Text, UnstyledButton } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React from "react";
import { ToolUiItem } from "../controller";

const ICONS: Record<string, string> = {
  read_file: "📄", write_file: "📝", edit_file: "✏️", delete_file: "🗑️",
  create_directory: "📁", move_file: "🔀", list_directory: "📂", find_files: "🗂️",
  search_text: "🔍", search_symbols: "🔣", search_semantic: "🧠", index_repository: "🧩",
  get_open_editors: "🪟", get_active_selection: "✂️", get_diagnostics: "🩺",
  run_command: "⚡", fetch_url: "🌐", remember: "💾", create_skill: "✨",
};

const LABELS: Record<string, string> = {
  read_file: "Read", write_file: "Write", edit_file: "Edit", delete_file: "Delete",
  create_directory: "New folder", move_file: "Move", list_directory: "List",
  find_files: "Find files", search_text: "Search", search_symbols: "Symbols",
  search_semantic: "Semantic", index_repository: "Index repo",
  get_open_editors: "Open editors", get_active_selection: "Selection",
  get_diagnostics: "Diagnostics", run_command: "Run", fetch_url: "Fetch",
  remember: "Remember", create_skill: "New skill",
};

export function ToolCallView({ item }: { item: ToolUiItem }) {
  const [open, { toggle }] = useDisclosure(false);
  const icon = ICONS[item.name] ?? (item.name.includes("_") ? "🧰" : "🔧");
  const label = LABELS[item.name] ?? item.name;
  const summary = summarize(item.args);

  return (
    <Paper withBorder radius="md" style={{ overflow: "hidden", background: "transparent" }}>
      <UnstyledButton onClick={toggle} style={{ width: "100%" }} px="sm" py={6}>
        <Group gap={8} wrap="nowrap">
          <Text size="sm">{icon}</Text>
          <Text fw={600} size="xs">{label}</Text>
          <Text
            size="xs"
            c="dimmed"
            truncate
            style={{ flex: 1, fontFamily: "var(--vscode-editor-font-family, monospace)" }}
          >
            {summary}
          </Text>
          {item.status === "running" ? (
            <Loader size={13} />
          ) : (
            <Text size="xs" c="dimmed">{open ? "▲" : "▼"}</Text>
          )}
        </Group>
      </UnstyledButton>
      {open && (
        <Box px="sm" pb="sm">
          <Text size="10px" c="dimmed" tt="uppercase" mb={2}>arguments</Text>
          <Code block fz="11px">{JSON.stringify(item.args, null, 2)}</Code>
          {item.result !== undefined && (
            <>
              <Text size="10px" c="dimmed" tt="uppercase" mt={8} mb={2}>result</Text>
              <Code block fz="11px" style={{ maxHeight: 260, overflow: "auto" }}>
                {item.result}
              </Code>
            </>
          )}
        </Box>
      )}
    </Paper>
  );
}

function summarize(args: unknown): string {
  const a = (args ?? {}) as Record<string, string>;
  return a.path ?? a.glob ?? a.query ?? a.command ?? a.url ?? a.from ?? a.name ?? a.note ?? "";
}
