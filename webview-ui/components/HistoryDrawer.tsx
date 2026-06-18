import { ActionIcon, Button, Checkbox, Drawer, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import React, { useState } from "react";
import { SessionSummary } from "../../src/shared/protocol";

interface HistoryDrawerProps {
  opened: boolean;
  onClose: () => void;
  sessions: SessionSummary[];
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onAnalyze: (ids: string[]) => void;
}

export function HistoryDrawer({
  opened,
  onClose,
  sessions,
  onLoad,
  onDelete,
  onAnalyze,
}: HistoryDrawerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const analyze = () => {
    onAnalyze([...selected]);
    setSelected(new Set());
    onClose();
  };

  return (
    <Drawer opened={opened} onClose={onClose} title="Chat history" position="right" size="sm" padding="sm">
      {selected.size > 0 && (
        <Button fullWidth size="xs" mb="xs" onClick={analyze}>
          Analyze {selected.size} selected
        </Button>
      )}
      <Stack gap={2}>
        {sessions.length === 0 && (
          <Text size="sm" c="dimmed" ta="center" mt="md">
            No saved chats yet.
          </Text>
        )}
        {sessions.map((s) => (
          <Group key={s.id} gap={6} wrap="nowrap">
            <Checkbox
              size="xs"
              checked={selected.has(s.id)}
              onChange={() => toggle(s.id)}
              aria-label="Select for analysis"
            />
            <UnstyledButton
              style={{ flex: 1, minWidth: 0 }}
              onClick={() => {
                onLoad(s.id);
                onClose();
              }}
              p={6}
            >
              <Text size="sm" truncate>{s.title}</Text>
              <Text size="10px" c="dimmed">{new Date(s.updatedAt).toLocaleString()}</Text>
            </UnstyledButton>
            <ActionIcon variant="subtle" color="red" size="sm" onClick={() => onDelete(s.id)} aria-label="Delete">
              ×
            </ActionIcon>
          </Group>
        ))}
      </Stack>
    </Drawer>
  );
}
