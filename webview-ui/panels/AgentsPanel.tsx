import {
  ActionIcon,
  Autocomplete,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  MultiSelect,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from "@mantine/core";
import React, { useEffect, useMemo, useState } from "react";
import { AgentDTO } from "../../src/shared/protocol";
import { Actions, ChatState } from "../controller";
import { modelOptionsForAgentProvider } from "./agentModelOptions";

function blankAgent(): AgentDTO {
  return { id: "", name: "", description: "", systemPrompt: "", tools: "all" };
}

type EditorTab = "general" | "model" | "tools" | "advanced";

export function AgentsPanel({ state, actions }: { state: ChatState; actions: Actions }) {
  const [editing, setEditing] = useState<AgentDTO | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "custom" | "builtin">("all");

  useEffect(() => {
    actions.listAgents();
  }, []);

  const filteredAgents = useMemo(() => {
    let agents = state.agentDtos;
    if (filterType === "custom") agents = agents.filter((a) => !a.builtIn);
    if (filterType === "builtin") agents = agents.filter((a) => a.builtIn);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      agents = agents.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q)
      );
    }
    return agents;
  }, [state.agentDtos, filterType, searchQuery]);

  if (editing) {
    return (
      <AgentEditor
        agent={editing}
        state={state}
        actions={actions}
        onCancel={() => setEditing(null)}
        onSave={(a) => {
          actions.saveAgent(a);
          setEditing(null);
        }}
        onDelete={
          editing.builtIn || !editing.id
            ? undefined
            : () => {
                actions.deleteAgent(editing.id);
                setEditing(null);
              }
        }
      />
    );
  }

  return (
    <ScrollArea className="panel-scroll">
      <Stack gap="md">
        <Group justify="space-between">
          <Text fw={700} size="lg">
            Agents
          </Text>
          <Group gap={4}>
            <Tooltip label="Import agent from file">
              <Button size="xs" variant="subtle" onClick={() => actions.importAgent()}>
                Import
              </Button>
            </Tooltip>
            <Button size="xs" onClick={() => setEditing(blankAgent())}>
              + New agent
            </Button>
          </Group>
        </Group>

        <TextInput
          placeholder="Search agents..."
          size="xs"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.currentTarget.value)}
          leftSection={<SearchIcon />}
          rightSection={
            searchQuery ? (
              <ActionIcon size="xs" variant="subtle" onClick={() => setSearchQuery("")}>
                <CloseIcon />
              </ActionIcon>
            ) : null
          }
        />

        <SegmentedControl
          size="xs"
          fullWidth
          data={[
            { label: "All", value: "all" },
            { label: "Custom", value: "custom" },
            { label: "Built-in", value: "builtin" },
          ]}
          value={filterType}
          onChange={(v) => setFilterType(v as typeof filterType)}
        />

        <Stack gap="xs">
          {filteredAgents.length === 0 && (
            <Paper p="md" ta="center" c="dimmed" withBorder>
              <Text size="sm">No agents found</Text>
            </Paper>
          )}
          {filteredAgents.map((a) => (
            <AgentCard key={a.id} agent={a} onEdit={() => setEditing({ ...a })} actions={actions} />
          ))}
        </Stack>
      </Stack>
    </ScrollArea>
  );
}

function AgentCard({
  agent,
  onEdit,
  actions,
}: {
  agent: AgentDTO;
  onEdit: () => void;
  actions: Actions;
}) {
  const toolCount = agent.tools === "all" ? "All" : `${agent.tools.length}`;
  const hasSubAgents = (agent.subAgents?.length ?? 0) > 0;
  const hasSkills = (agent.skills?.length ?? 0) > 0;

  return (
    <Card
      className="agent-card"
      padding="sm"
      radius="md"
      withBorder
      style={{ cursor: "pointer", transition: "all 0.15s ease" }}
      onClick={onEdit}
    >
      <Group justify="space-between" wrap="nowrap">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6} mb={4}>
            <Text fw={600} size="sm" truncate>
              {agent.name}
            </Text>
            {agent.builtIn && (
              <Badge size="xs" variant="light" color="blue">
                built-in
              </Badge>
            )}
            {agent.provider && (
              <Badge size="xs" variant="outline" color="gray">
                {agent.provider}
              </Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed" lineClamp={2} mb={6}>
            {agent.description || "No description"}
          </Text>
          <Group gap={8}>
            <ToolBadge icon={<WrenchIcon />} label={`${toolCount} tools`} />
            {hasSubAgents && (
              <ToolBadge icon={<UsersIcon />} label={`${agent.subAgents!.length} sub-agents`} />
            )}
            {hasSkills && (
              <ToolBadge icon={<SparklesIcon />} label={`${agent.skills!.length} skills`} />
            )}
          </Group>
        </div>
        <Group gap={4} onClick={(e) => e.stopPropagation()}>
          <Tooltip label={agent.builtIn ? "View" : "Edit"}>
            <ActionIcon variant="light" size="sm" onClick={onEdit}>
              {agent.builtIn ? <EyeIcon /> : <PencilIcon />}
            </ActionIcon>
          </Tooltip>
          {!agent.builtIn && (
            <Tooltip label="Export as JSON">
              <ActionIcon variant="subtle" size="sm" onClick={() => actions.exportAgent(agent)}>
                <DownloadIcon />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>
    </Card>
  );
}

function ToolBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <Group gap={4} className="tool-badge">
      {icon}
      <Text size="10px" c="dimmed">
        {label}
      </Text>
    </Group>
  );
}

function AgentEditor({
  agent,
  state,
  actions,
  onCancel,
  onSave,
  onDelete,
}: {
  agent: AgentDTO;
  state: ChatState;
  actions: Actions;
  onCancel: () => void;
  onSave: (a: AgentDTO) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<AgentDTO>(agent);
  const [activeTab, setActiveTab] = useState<EditorTab>("general");
  const readOnly = !!draft.builtIn;
  const allTools = draft.tools === "all";

  const toolOptions = state.toolCatalog.map((t) => ({
    value: t.name,
    label: `${t.name}${t.mutating ? " (mutating)" : ""}`,
    group: t.source === "mcp" ? "MCP Tools" : "Built-in Tools",
  }));
  const skillOptions = state.skills.map((s) => ({ value: s.name, label: s.name }));
  const agentOptions = state.agentDtos
    .filter((a) => a.id !== draft.id)
    .map((a) => ({ value: a.id, label: a.name }));
  const providerOptions = [
    { value: "", label: "Use active provider" },
    ...state.providers.map((p) => ({ value: p.id, label: p.label })),
  ];
  const modelOptions = modelOptionsForAgentProvider({
    providerId: draft.provider,
    activeProviderId: state.provider,
    providers: state.providers,
    modelsByProvider: state.modelsByProvider,
  });
  const effectiveProviderId = draft.provider || state.provider;

  useEffect(() => {
    if (effectiveProviderId) {
      actions.listModels(effectiveProviderId);
    }
  }, [effectiveProviderId]);

  const updateDraft = (patch: Partial<AgentDTO>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <ScrollArea className="panel-scroll">
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="sm">
            <Tooltip label="Back">
              <ActionIcon variant="subtle" onClick={onCancel}>
                <ArrowLeftIcon />
              </ActionIcon>
            </Tooltip>
            <Text fw={700} size="lg">
              {readOnly ? "Agent (read-only)" : draft.id ? "Edit agent" : "New agent"}
            </Text>
          </Group>
          {!readOnly && (
            <Group gap={4}>
              {onDelete && (
                <Tooltip label="Delete agent">
                  <ActionIcon color="red" variant="light" onClick={onDelete}>
                    <TrashIcon />
                  </ActionIcon>
                </Tooltip>
              )}
              <Tooltip label="Export">
                <ActionIcon variant="subtle" onClick={() => actions.exportAgent(draft)}>
                  <DownloadIcon />
                </ActionIcon>
              </Tooltip>
            </Group>
          )}
        </Group>

        <SegmentedControl
          size="xs"
          fullWidth
          data={[
            { label: "General", value: "general" },
            { label: "Model", value: "model" },
            { label: "Tools", value: "tools" },
            { label: "Advanced", value: "advanced" },
          ]}
          value={activeTab}
          onChange={(v) => setActiveTab(v as EditorTab)}
        />

        {activeTab === "general" && (
          <Stack gap="sm">
            <TextInput
              label="Name"
              description="A unique identifier for this agent"
              value={draft.name}
              disabled={readOnly}
              onChange={(e) => updateDraft({ name: e.currentTarget.value })}
              placeholder="e.g., code-reviewer"
            />
            <TextInput
              label="Description"
              description="Brief description shown in agent selection"
              value={draft.description}
              disabled={readOnly}
              onChange={(e) => updateDraft({ description: e.currentTarget.value })}
              placeholder="e.g., Reviews code for quality and best practices"
            />
            <Textarea
              label="System prompt"
              description="Instructions that define the agent's behavior"
              autosize
              minRows={4}
              maxRows={12}
              value={draft.systemPrompt}
              disabled={readOnly}
              onChange={(e) => updateDraft({ systemPrompt: e.currentTarget.value })}
              placeholder="You are a helpful code reviewer..."
            />
          </Stack>
        )}

        {activeTab === "model" && (
          <Stack gap="sm">
            <Select
              label="Provider override"
              description="Leave empty to use the active provider"
              data={providerOptions}
              value={draft.provider ?? ""}
              disabled={readOnly}
              onChange={(v) => updateDraft({ provider: v || undefined })}
            />
            <Autocomplete
              label="Model override"
              description="Specify a model or leave empty for provider default"
              value={draft.model ?? ""}
              disabled={readOnly}
              placeholder="e.g., gpt-4, claude-3-opus"
              data={modelOptions}
              limit={50}
              maxDropdownHeight={280}
              onChange={(v) => updateDraft({ model: v || undefined })}
              comboboxProps={{ withinPortal: true }}
            />
          </Stack>
        )}

        {activeTab === "tools" && (
          <Stack gap="sm">
            <Switch
              label="Allow all tools"
              description="Enable all available tools for this agent"
              checked={allTools}
              disabled={readOnly}
              onChange={(e) =>
                updateDraft({ tools: e.currentTarget.checked ? "all" : [] })
              }
            />
            {!allTools && (
              <MultiSelect
                label="Allowed tools"
                description="Select specific tools this agent can use"
                data={toolOptions}
                value={draft.tools === "all" ? [] : draft.tools}
                disabled={readOnly}
                searchable
                onChange={(v) => updateDraft({ tools: v })}
                limit={50}
                maxDropdownHeight={280}
              />
            )}
            <MultiSelect
              label="Always-on skills"
              description="Skills automatically loaded for this agent"
              data={skillOptions}
              value={draft.skills ?? []}
              disabled={readOnly}
              onChange={(v) => updateDraft({ skills: v })}
            />
          </Stack>
        )}

        {activeTab === "advanced" && (
          <Stack gap="sm">
            <MultiSelect
              label="Sub-agents (delegation)"
              description="Agents this one may hand off subtasks to"
              data={agentOptions}
              value={draft.subAgents ?? []}
              disabled={readOnly}
              onChange={(v) => updateDraft({ subAgents: v })}
            />
          </Stack>
        )}

        {!readOnly && (
          <Group justify="flex-end" mt="sm">
            <Button variant="light" size="xs" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="xs" onClick={() => onSave(draft)} disabled={!draft.name.trim()}>
              Save agent
            </Button>
          </Group>
        )}
      </Stack>
    </ScrollArea>
  );
}

function ToolBadge2({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <Group gap={4} className="tool-badge">
      {icon}
      <Text size="10px" c="dimmed">
        {label}
      </Text>
    </Group>
  );
}

// --- Icons ---

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  );
}
