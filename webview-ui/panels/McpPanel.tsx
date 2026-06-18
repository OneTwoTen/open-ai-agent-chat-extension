import {
  Badge,
  Button,
  Card,
  Group,
  ScrollArea,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import React, { useEffect, useState } from "react";
import { McpServerConfig, McpTransport } from "../../src/shared/protocol";
import { Actions, ChatState } from "../controller";

function blankServer(): McpServerConfig {
  return { id: "", transport: "stdio", command: "", args: [], url: "", enabled: true };
}

const STATUS_COLOR: Record<string, string> = {
  connected: "green",
  disconnected: "gray",
  error: "red",
};

export function McpPanel({ state, actions }: { state: ChatState; actions: Actions }) {
  const [draft, setDraft] = useState<McpServerConfig | null>(null);

  useEffect(() => {
    actions.listMcp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScrollArea className="panel-scroll">
      <Group justify="space-between" mb="sm">
        <Text fw={700}>MCP servers</Text>
        <Group gap={6}>
          <Button size="compact-xs" variant="subtle" onClick={actions.reconnectMcp}>
            Reconnect
          </Button>
          <Button size="xs" onClick={() => setDraft(blankServer())}>
            + Add
          </Button>
        </Group>
      </Group>

      {draft && (
        <Card withBorder radius="md" padding="sm" mb="sm">
          <Stack gap="xs">
            <TextInput
              label="Server id"
              value={draft.id}
              onChange={(e) => setDraft({ ...draft, id: e.currentTarget.value })}
            />
            <SegmentedControl
              size="xs"
              fullWidth
              data={["stdio", "sse", "http"]}
              value={draft.transport}
              onChange={(v) => setDraft({ ...draft, transport: v as McpTransport })}
            />
            {draft.transport === "stdio" ? (
              <>
                <TextInput
                  label="Command"
                  placeholder="npx"
                  value={draft.command}
                  onChange={(e) => setDraft({ ...draft, command: e.currentTarget.value })}
                />
                <TextInput
                  label="Args (space-separated)"
                  placeholder="-y @modelcontextprotocol/server-filesystem ."
                  value={(draft.args ?? []).join(" ")}
                  onChange={(e) =>
                    setDraft({ ...draft, args: e.currentTarget.value.split(/\s+/).filter(Boolean) })
                  }
                />
              </>
            ) : (
              <TextInput
                label="URL"
                placeholder="https://host/mcp"
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.currentTarget.value })}
              />
            )}
            <Switch
              label="Enabled"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.currentTarget.checked })}
            />
            <Group justify="flex-end" gap={6}>
              <Button size="compact-xs" variant="subtle" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button
                size="xs"
                disabled={!draft.id.trim()}
                onClick={() => {
                  actions.saveMcpServer(draft);
                  setDraft(null);
                }}
              >
                Save & connect
              </Button>
            </Group>
          </Stack>
        </Card>
      )}

      <Stack gap="xs">
        {state.mcpServers.length === 0 && (
          <Text size="sm" c="dimmed">
            No MCP servers configured. Add one, or create .agentchat/mcp.json. The `mcpServers`
            map format from Claude/Cursor is also supported.
          </Text>
        )}
        {state.mcpServers.map((s) => (
          <Card key={s.id} withBorder radius="md" padding="sm">
            <Group justify="space-between" wrap="nowrap">
              <div style={{ minWidth: 0 }}>
                <Group gap={6}>
                  <Text fw={600} size="sm">{s.id}</Text>
                  <Badge size="xs" color={STATUS_COLOR[s.status]} variant="light">
                    {s.status}
                  </Badge>
                  <Badge size="xs" variant="outline">{s.transport}</Badge>
                </Group>
                <Text size="xs" c="dimmed">
                  {s.toolCount} tool{s.toolCount === 1 ? "" : "s"}
                  {s.tools.length ? `: ${s.tools.slice(0, 6).join(", ")}` : ""}
                </Text>
                {s.error && (
                  <Text size="xs" c="red" lineClamp={2}>{s.error}</Text>
                )}
              </div>
              <Button
                size="compact-xs"
                variant="light"
                color="red"
                onClick={() => actions.deleteMcpServer(s.id)}
              >
                Remove
              </Button>
            </Group>
          </Card>
        ))}
      </Stack>
    </ScrollArea>
  );
}
