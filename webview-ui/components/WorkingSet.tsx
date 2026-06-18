import { ActionIcon, Box, Group, Paper, Stack, Text, Tooltip } from "@mantine/core";
import React from "react";
import { WorkingSetFile } from "../../src/shared/protocol";

interface WorkingSetProps {
  files: WorkingSetFile[];
  onOpenFile?: (path: string) => void;
}

const STATUS_ICONS: Record<string, string> = {
  created: "🆕",
  modified: "✏️",
  deleted: "🗑️",
  moved: "📦",
};

const STATUS_COLORS: Record<string, string> = {
  created: "green",
  modified: "blue",
  deleted: "red",
  moved: "orange",
};

export function WorkingSet({ files, onOpenFile }: WorkingSetProps) {
  if (files.length === 0) {
    return null;
  }

  return (
    <Paper withBorder p="xs" radius="md" mb="xs">
      <Group gap={6} mb={4}>
        <Text size="xs" fw={600}>
          Working Set
        </Text>
        <Text size="xs" c="dimmed">
          ({files.length} file{files.length !== 1 ? "s" : ""})
        </Text>
      </Group>
      <Stack gap={2}>
        {files.map((file) => (
          <Group
            key={file.path}
            gap={6}
            wrap="nowrap"
            py={2}
            px={4}
            style={{ borderRadius: 4, cursor: "pointer" }}
            onClick={() => onOpenFile?.(file.path)}
            className="working-set-file"
          >
            <Tooltip label={file.status} withArrow>
              <Text size="sm">{STATUS_ICONS[file.status]}</Text>
            </Tooltip>
            <Text
              size="xs"
              truncate
              style={{ flex: 1 }}
              c={file.status === "deleted" ? "dimmed" : undefined}
              td={file.status === "deleted" ? "line-through" : undefined}
            >
              {file.path}
            </Text>
            {file.fromPath && (
              <Text size="xs" c="dimmed">
                ← {file.fromPath}
              </Text>
            )}
          </Group>
        ))}
      </Stack>
    </Paper>
  );
}
