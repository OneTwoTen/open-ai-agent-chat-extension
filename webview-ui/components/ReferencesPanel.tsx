import { ActionIcon, Box, Group, Paper, Stack, Text, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React from "react";
import { ToolUiItem } from "../controller";

interface ReferencesPanelProps {
  toolCalls: ToolUiItem[];
  onOpenFile?: (path: string) => void;
}

const TOOL_ICONS: Record<string, string> = {
  read_file: "📄", write_file: "📝", edit_file: "✏️", delete_file: "🗑️",
  create_directory: "📁", move_file: "🔀", list_directory: "📂", find_files: "🗂️",
  search_text: "🔍", search_symbols: "🔣", search_semantic: "🧠", index_repository: "🧩",
  get_open_editors: "🪟", get_active_selection: "✂️", get_diagnostics: "🩺",
  run_command: "⚡", fetch_url: "🌐", remember: "💾", create_skill: "✨",
  delegate: "🤖",
};

function extractFilePaths(toolCalls: ToolUiItem[]): string[] {
  const paths = new Set<string>();
  for (const tc of toolCalls) {
    const args = (tc.args ?? {}) as Record<string, string>;
    if (args.path) paths.add(args.path);
    if (args.from) paths.add(args.from);
    if (args.to) paths.add(args.to);
  }
  return [...paths].sort();
}

function extractToolSummary(toolCalls: ToolUiItem[]): { name: string; count: number; icon: string }[] {
  const counts = new Map<string, number>();
  for (const tc of toolCalls) {
    counts.set(tc.name, (counts.get(tc.name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({
      name,
      count,
      icon: TOOL_ICONS[name] ?? "🔧",
    }))
    .sort((a, b) => b.count - a.count);
}

export function ReferencesPanel({ toolCalls, onOpenFile }: ReferencesPanelProps) {
  const [open, { toggle }] = useDisclosure(false);
  
  if (toolCalls.length === 0) {
    return null;
  }

  const filePaths = extractFilePaths(toolCalls);
  const toolSummary = extractToolSummary(toolCalls);
  const running = toolCalls.some((tc) => tc.status === "running");

  return (
    <Paper withBorder radius="md" mb="xs" style={{ overflow: "hidden" }}>
      <Group
        px="sm"
        py={6}
        gap={8}
        onClick={toggle}
        style={{ cursor: "pointer" }}
        wrap="nowrap"
      >
        <Text size="xs" fw={600}>
          References
        </Text>
        <Text size="xs" c="dimmed">
          {toolCalls.length} tool call{toolCalls.length !== 1 ? "s" : ""} · {filePaths.length} file{filePaths.length !== 1 ? "s" : ""}
        </Text>
        {running && (
          <Text size="xs" c="blue">
            ●
          </Text>
        )}
        <Text size="xs" c="dimmed" style={{ marginLeft: "auto" }}>
          {open ? "▲" : "▼"}
        </Text>
      </Group>
      
      {open && (
        <Box px="sm" pb="sm">
          {toolSummary.length > 0 && (
            <Stack gap={4} mb={8}>
              <Text size="10px" c="dimmed" tt="uppercase">Tools used</Text>
              <Group gap={4} wrap="wrap">
                {toolSummary.map((t) => (
                  <Group key={t.name} gap={4} px={6} py={2} style={{ 
                    background: "var(--mantine-color-default-hover)", 
                    borderRadius: 4 
                  }}>
                    <Text size="xs">{t.icon}</Text>
                    <Text size="xs" fw={500}>{t.name}</Text>
                    {t.count > 1 && (
                      <Text size="xs" c="dimmed">×{t.count}</Text>
                    )}
                  </Group>
                ))}
              </Group>
            </Stack>
          )}
          
          {filePaths.length > 0 && (
            <Stack gap={4}>
              <Text size="10px" c="dimmed" tt="uppercase">Files accessed</Text>
              <Stack gap={2}>
                {filePaths.map((fp) => (
                  <Group
                    key={fp}
                    gap={6}
                    wrap="nowrap"
                    py={2}
                    px={4}
                    style={{ 
                      borderRadius: 4, 
                      cursor: "pointer",
                      background: "var(--mantine-color-default-hover)",
                    }}
                    onClick={() => onOpenFile?.(fp)}
                  >
                    <Text size="xs">📄</Text>
                    <Text size="xs" truncate style={{ flex: 1 }}>
                      {fp}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </Stack>
          )}
        </Box>
      )}
    </Paper>
  );
}
