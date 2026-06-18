import {
  ActionIcon,
  Alert,
  Autocomplete,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  HoverCard,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Tooltip,
  Switch,
} from "@mantine/core";
import React, { useEffect, useMemo, useState } from "react";
import { PermissionLevel, ReasoningEffort } from "../src/shared/protocol";
import { HistoryDrawer } from "./components/HistoryDrawer";
import { useController } from "./controller";
import { modelOptionsForProvider } from "./panels/agentModelOptions";
import { AgentsPanel } from "./panels/AgentsPanel";
import { ChatPanel } from "./panels/ChatPanel";
import { McpPanel } from "./panels/McpPanel";
import { SkillsPanel } from "./panels/SkillsPanel";
import { TelegramPanel } from "./panels/TelegramPanel";

const REASONING: { value: ReasoningEffort; label: string }[] = [
  { value: "off", label: "No reasoning" },
  { value: "low", label: "Reasoning: low" },
  { value: "medium", label: "Reasoning: medium" },
  { value: "high", label: "Reasoning: high" },
];

const PERMISSION: { value: PermissionLevel; label: string }[] = [
  { value: "readonly", label: "Read-only" },
  { value: "ask", label: "Ask before edits" },
  { value: "auto", label: "Autonomous" },
];

export function App() {
  const { state, actions } = useController();
  const [tab, setTab] = useState<string>("chat");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const activeProvider = state.providers.find((p) => p.id === state.provider);
  const caps = activeProvider?.capabilities;

  // Fetch the provider's model list whenever the active provider changes.
  useEffect(() => {
    if (state.provider) {
      actions.listModels(state.provider);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.provider]);

  const modelData = useMemo(() => {
    const fetched = state.modelsByProvider[state.provider] ?? [];
    return Array.from(new Set([...fetched, ...(activeProvider?.exampleModels ?? [])]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.modelsByProvider, state.provider, activeProvider]);

  return (
    <Box className="shell">
      <Box
        p="xs"
        style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
      >
        <Group gap={6} wrap="nowrap">
          <Select
            size="xs"
            w={130}
            data={state.providers.map((p) => ({ value: p.id, label: p.label }))}
            value={state.provider}
            onChange={(v) => v && actions.selectProvider(v)}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
          />
          <Autocomplete
            size="xs"
            style={{ flex: 1 }}
            placeholder="model"
            data={modelData}
            value={state.model}
            onChange={actions.selectModel}
            limit={50}
            maxDropdownHeight={280}
            comboboxProps={{ withinPortal: true }}
          />
          <Tooltip label="Refresh model list" withArrow>
            <ActionIcon
              variant="subtle"
              size="lg"
              onClick={() => actions.listModels(state.provider, true)}
              aria-label="Refresh models"
            >
              <RefreshIcon />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Provider settings" withArrow>
            <ActionIcon
              variant="subtle"
              size="lg"
              onClick={() => setSettingsOpen(true)}
              aria-label="Provider settings"
            >
              <SettingsIcon />
            </ActionIcon>
          </Tooltip>
          <CapabilityInfo caps={caps} providerLabel={activeProvider?.label ?? state.provider} />
          <Tooltip label="Chat history" withArrow>
            <ActionIcon variant="subtle" size="lg" onClick={() => {
              actions.requestSessions();
              setHistoryOpen(true);
            }}>
              <HistoryIcon />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="New chat" withArrow>
            <ActionIcon variant="subtle" size="lg" onClick={actions.newChat}>
              <PlusIcon />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Export Markdown" withArrow>
            <ActionIcon variant="subtle" size="lg" onClick={actions.exportMarkdown} aria-label="Export Markdown">
              <ExportIcon />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Open in editor (full screen)" withArrow>
            <ActionIcon variant="subtle" size="lg" onClick={actions.openInEditor} aria-label="Full screen">
              <FullScreenIcon />
            </ActionIcon>
          </Tooltip>
        </Group>

        {tab === "chat" && (
          <Group gap={6} mt={6} wrap="nowrap">
            <Select
              size="xs"
              style={{ flex: 1 }}
              data={state.agents.map((a) => ({ value: a.id, label: a.name }))}
              value={state.agentId}
              onChange={(v) => v && actions.selectAgent(v)}
              allowDeselect={false}
              comboboxProps={{ withinPortal: true }}
            />
            <Tooltip label={caps?.reasoning ? "" : "Active model has no reasoning controls"} disabled={!!caps?.reasoning} withArrow>
              <Select
                size="xs"
                w={120}
                data={REASONING}
                value={state.reasoning}
                disabled={!caps?.reasoning}
                onChange={(v) => v && actions.selectReasoning(v as ReasoningEffort)}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
              />
            </Tooltip>
            <Select
              size="xs"
              w={120}
              data={PERMISSION}
              value={state.permission}
              onChange={(v) => v && actions.selectPermission(v as PermissionLevel)}
              allowDeselect={false}
              comboboxProps={{ withinPortal: true }}
            />
          </Group>
        )}
      </Box>

      {!state.hasApiKey && (
        <Alert color="yellow" variant="light" radius={0} py={6} px="sm">
          <Group gap={8}>
            <Text size="xs">No API key for {activeProvider?.label ?? state.provider}.</Text>
            <Text size="xs" c="blue" style={{ cursor: "pointer", textDecoration: "underline" }} onClick={actions.setApiKey}>
              Set key
            </Text>
          </Group>
        </Alert>
      )}

      <Tabs value={tab} onChange={(v) => setTab(v ?? "chat")} variant="default">
        <Tabs.List grow>
          <Tabs.Tab value="chat">Chat</Tabs.Tab>
          <Tabs.Tab value="agents">Agents</Tabs.Tab>
          <Tabs.Tab value="skills">Skills</Tabs.Tab>
          <Tabs.Tab value="mcp">MCP</Tabs.Tab>
          <Tabs.Tab value="telegram">Telegram</Tabs.Tab>
        </Tabs.List>
      </Tabs>

      {tab === "chat" && <ChatPanel state={state} actions={actions} />}
      {tab === "agents" && <AgentsPanel state={state} actions={actions} />}
      {tab === "skills" && <SkillsPanel state={state} actions={actions} />}
      {tab === "mcp" && <McpPanel state={state} actions={actions} />}
      {tab === "telegram" && <TelegramPanel state={state} actions={actions} />}

      <HistoryDrawer
        opened={historyOpen}
        onClose={() => setHistoryOpen(false)}
        sessions={state.sessions}
        onLoad={actions.loadSession}
        onDelete={actions.deleteSession}
        onAnalyze={actions.analyzeSessions}
      />
      <ProviderSettingsModal
        opened={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        state={state}
        actions={actions}
      />
    </Box>
  );
}

function ProviderSettingsModal({
  opened,
  onClose,
  state,
  actions,
}: {
  opened: boolean;
  onClose: () => void;
  state: ReturnType<typeof useController>["state"];
  actions: ReturnType<typeof useController>["actions"];
}) {
  const [providerKey, setProviderKey] = useState("");
  const [fileKey, setFileKey] = useState("");
  const [main, setMain] = useState({
    provider: state.provider,
    model: state.model,
    baseUrl: state.baseUrl,
  });
  const [file, setFile] = useState({
    enabled: state.fileAnalysis.enabled,
    provider: state.fileAnalysis.provider,
    model: state.fileAnalysis.model,
    baseUrl: state.fileAnalysis.baseUrl,
  });

  useEffect(() => {
    if (!opened) {
      return;
    }
    setMain({ provider: state.provider, model: state.model, baseUrl: state.baseUrl });
    setFile({
      enabled: state.fileAnalysis.enabled,
      provider: state.fileAnalysis.provider,
      model: state.fileAnalysis.model,
      baseUrl: state.fileAnalysis.baseUrl,
    });
    setProviderKey("");
    setFileKey("");
  }, [opened, state.provider, state.model, state.baseUrl, state.fileAnalysis]);

  const providers = state.providers.map((p) => ({ value: p.id, label: p.label }));
  const mainModelData = useMemo(
    () =>
      modelOptionsForProvider({
        providerId: main.provider,
        providers: state.providers,
        modelsByProvider: state.modelsByProvider,
      }),
    [main.provider, state.providers, state.modelsByProvider]
  );
  const fileModelData = useMemo(
    () =>
      modelOptionsForProvider({
        providerId: file.provider,
        providers: state.providers,
        modelsByProvider: state.modelsByProvider,
      }),
    [file.provider, state.providers, state.modelsByProvider]
  );
  const save = () => {
    actions.saveProviderSettings({ ...main, apiKey: providerKey });
    actions.saveFileAnalysisSettings({ ...file, apiKey: fileKey });
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Model settings" centered size="lg">
      <Stack gap="sm">
        <Text size="xs" fw={700}>Main agent model</Text>
        <Group gap="xs" grow>
          <Select
            size="xs"
            label="Provider"
            data={providers}
            value={main.provider}
            onChange={(v) => {
              if (!v) return;
              setMain((s) => ({ ...s, provider: v }));
              actions.listModels(v);
            }}
            allowDeselect={false}
          />
          <Autocomplete
            size="xs"
            label="Model"
            data={mainModelData}
            value={main.model}
            onChange={(value) => setMain((s) => ({ ...s, model: value }))}
            limit={50}
            maxDropdownHeight={280}
            comboboxProps={{ withinPortal: true }}
          />
        </Group>
        <TextInput
          size="xs"
          label="Base URL"
          placeholder="https://api.openai.com/v1"
          value={main.baseUrl}
          onChange={(e) => setMain((s) => ({ ...s, baseUrl: e.currentTarget.value }))}
        />
        <PasswordInput
          size="xs"
          label={state.hasApiKey ? "API key (leave blank to keep current)" : "API key"}
          value={providerKey}
          onChange={(e) => setProviderKey(e.currentTarget.value)}
        />

        <Divider />

        <Group justify="space-between" align="center">
          <Text size="xs" fw={700}>File analysis model</Text>
          <Switch
            size="xs"
            checked={file.enabled}
            onChange={(e) => setFile((s) => ({ ...s, enabled: e.currentTarget.checked }))}
          />
        </Group>
        <Group gap="xs" grow>
          <Select
            size="xs"
            label="Provider"
            data={providers}
            value={file.provider}
            onChange={(v) => {
              if (!v) return;
              setFile((s) => ({ ...s, provider: v }));
              actions.listModels(v);
            }}
            allowDeselect={false}
          />
          <Autocomplete
            size="xs"
            label="Model"
            data={fileModelData}
            value={file.model}
            onChange={(value) => setFile((s) => ({ ...s, model: value }))}
            limit={50}
            maxDropdownHeight={280}
            comboboxProps={{ withinPortal: true }}
          />
        </Group>
        <TextInput
          size="xs"
          label="Base URL"
          placeholder="Use provider default"
          value={file.baseUrl}
          onChange={(e) => setFile((s) => ({ ...s, baseUrl: e.currentTarget.value }))}
        />
        <PasswordInput
          size="xs"
          label={
            state.fileAnalysis.hasApiKey
              ? "File model API key (leave blank to keep current)"
              : "File model API key"
          }
          value={fileKey}
          onChange={(e) => setFileKey(e.currentTarget.value)}
        />
        <Group justify="flex-end" gap="xs">
          <Text size="xs" c="dimmed">
            File analysis reads images/PDFs first, then sends markdown to the agent.
          </Text>
          <Button size="xs" onClick={save}>Save</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function CapabilityInfo({
  caps,
  providerLabel,
}: {
  caps?: { tools: boolean; reasoning: boolean; images: boolean; promptCache: string };
  providerLabel: string;
}) {
  if (!caps) {
    return null;
  }
  return (
    <HoverCard width={230} shadow="md" withArrow openDelay={120} position="bottom-end">
      <HoverCard.Target>
        <ActionIcon variant="subtle" size="lg" aria-label="Capabilities">
          <InfoIcon />
        </ActionIcon>
      </HoverCard.Target>
      <HoverCard.Dropdown>
        <Stack gap={6}>
          <Text size="xs" fw={700}>{providerLabel} capabilities</Text>
          <Group gap={6}>
            <Cap on={caps.tools} label="Tools" />
            <Cap on={caps.reasoning} label="Reasoning" />
            <Cap on={caps.images} label="Images" />
          </Group>
          <Text size="xs" c="dimmed">
            Prompt cache: {caps.promptCache}
          </Text>
        </Stack>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

function Cap({ on, label }: { on: boolean; label: string }) {
  return (
    <Badge size="xs" variant="light" color={on ? "green" : "gray"}>
      {on ? "✓" : "✕"} {label}
    </Badge>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function HistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.2.63.78 1 1.43 1H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
    </svg>
  );
}
function ExportIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}
function FullScreenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}
