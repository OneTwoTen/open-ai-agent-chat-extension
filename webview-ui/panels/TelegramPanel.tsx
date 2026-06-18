import {
  Badge,
  Button,
  Card,
  Group,
  ScrollArea,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import React, { useEffect, useState } from "react";
import { TelegramConfigUpdate } from "../../src/shared/protocol";
import { Actions, ChatState } from "../controller";

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function TelegramPanel({ state, actions }: { state: ChatState; actions: Actions }) {
  const [configDraft, setConfigDraft] = useState<TelegramConfigUpdate>(() => ({
    allowedChatIds: state.telegramStatus.allowedChatIds,
    workspacePath: state.telegramStatus.workspacePath,
    startOnActivation: state.telegramStatus.startOnActivation,
    proxyUrl: state.telegramStatus.proxyUrl,
  }));
  const [idsText, setIdsText] = useState(
    state.telegramStatus.allowedChatIds.join(", ")
  );

  useEffect(() => {
    actions.getTelegramStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setConfigDraft((prev) => ({
      ...prev,
      allowedChatIds: state.telegramStatus.allowedChatIds,
      workspacePath: state.telegramStatus.workspacePath,
      startOnActivation: state.telegramStatus.startOnActivation,
      proxyUrl: state.telegramStatus.proxyUrl,
    }));
    setIdsText(state.telegramStatus.allowedChatIds.join(", "));
  }, [
    state.telegramStatus.allowedChatIds,
    state.telegramStatus.workspacePath,
    state.telegramStatus.startOnActivation,
    state.telegramStatus.proxyUrl,
  ]);

  const st = state.telegramStatus;

  return (
    <ScrollArea className="panel-scroll">
      {/* ── Status card ───────────────────────────────────── */}
      <Card withBorder radius="md" padding="sm" mb="md">
        <Group justify="space-between" mb="xs">
          <Text fw={700}>Telegram Bot</Text>
          <Badge size="lg" color={st.running ? "green" : "gray"} variant="light">
            {st.running ? "● Running" : "○ Stopped"}
          </Badge>
        </Group>
        {st.running && (
          <Stack gap={4}>
            <Text size="sm">Uptime: {formatUptime(st.uptime)}</Text>
            <Text size="sm">Active chats: {st.chatCount}</Text>
          </Stack>
        )}
        <Group gap={6} mt="sm">
          {st.running ? (
            <Button size="xs" color="red" onClick={actions.stopTelegram}>
              Stop Bot
            </Button>
          ) : (
            <Button size="xs" onClick={actions.startTelegram}>
              Start Bot
            </Button>
          )}
          <Button size="xs" variant="subtle" onClick={actions.setTelegramToken}>
            Set Token
          </Button>
        </Group>
      </Card>

      {/* ── Configuration card ────────────────────────────── */}
      <Card withBorder radius="md" padding="sm" mb="md">
        <Text fw={700} mb="xs">Configuration</Text>
        <Stack gap="sm">
          <div>
            <Text size="xs" fw={600} mb={4}>Allowed Chat IDs</Text>
            <TextInput
              size="xs"
              placeholder="123456789, 987654321"
              value={idsText}
              onChange={(e) => {
                setIdsText(e.currentTarget.value);
                const ids = e.currentTarget.value
                  .split(/[,\s]+/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map(Number)
                  .filter((n) => !isNaN(n));
                setConfigDraft((prev) => ({ ...prev, allowedChatIds: ids }));
              }}
            />
            <Text size="xs" c="dimmed" mt={2}>
              Comma-separated Telegram user/group IDs. Empty = anyone with the token can use the bot.
            </Text>
          </div>

          <div>
            <Text size="xs" fw={600} mb={4}>Workspace Path</Text>
            <TextInput
              size="xs"
              placeholder="C:/projects/my-app"
              value={configDraft.workspacePath}
              onChange={(e) =>
                setConfigDraft((prev) => ({ ...prev, workspacePath: e.currentTarget.value }))
              }
            />
            <Text size="xs" c="dimmed" mt={2}>
              Absolute path to the workspace folder. Leave empty to use the first VS Code workspace folder.
            </Text>
          </div>

          <Switch
            size="xs"
            label="Auto-start on activation"
            checked={configDraft.startOnActivation}
            onChange={(e) =>
              setConfigDraft((prev) => ({ ...prev, startOnActivation: e.currentTarget.checked }))
            }
          />

          <div>
            <Text size="xs" fw={600} mb={4}>Proxy URL</Text>
            <TextInput
              size="xs"
              placeholder="http://127.0.0.1:7890"
              value={configDraft.proxyUrl}
              onChange={(e) =>
                setConfigDraft((prev) => ({ ...prev, proxyUrl: e.currentTarget.value }))
              }
            />
            <Text size="xs" c="dimmed" mt={2}>
              HTTP/HTTPS proxy for Telegram API. Leave empty for direct connection.
            </Text>
          </div>

          <Group justify="flex-end">
            <Button
              size="xs"
              onClick={() => {
                actions.updateTelegramConfig(configDraft);
                actions.getTelegramStatus();
              }}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Card>

      {/* ── Usage tips card ───────────────────────────────── */}
      <Card withBorder radius="md" padding="sm">
        <Text fw={700} mb="xs">Usage</Text>
        <Stack gap={4}>
          <Text size="sm">
            1. Create a bot via <Text component="span" c="blue" inherit>@BotFather</Text> on Telegram
          </Text>
          <Text size="sm">
            2. Set the bot token via <Text component="span" c="blue" inherit>"Set Token"</Text> button above
          </Text>
          <Text size="sm">
            3. Configure allowed chat IDs (optional but recommended)
          </Text>
          <Text size="sm">
            4. Start the bot and send <Text component="span" c="blue" inherit>/start</Text> from Telegram
          </Text>
        </Stack>
        <Text size="xs" c="dimmed" mt="sm">
          Commands: /chat, /agent, /workspace, /session, /new, /cancel, /status, /help
        </Text>
      </Card>
    </ScrollArea>
  );
}
