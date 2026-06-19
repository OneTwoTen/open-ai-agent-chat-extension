import {
  Autocomplete,
  Badge,
  Button,
  Card,
  Group,
  MultiSelect,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from "@mantine/core";
import React, { useEffect, useState } from "react";
import { AgentDTO } from "../../src/shared/protocol";
import { Actions, ChatState } from "../controller";
import { modelOptionsForAgentProvider } from "./agentModelOptions";

function blankAgent(): AgentDTO {
  return { id: "", name: "", description: "", systemPrompt: "", tools: "all" };
}

export function AgentsPanel({ state, actions }: { state: ChatState; actions: Actions }) {
  const [editing, setEditing] = useState<AgentDTO | null>(null);

  useEffect(() => {
    actions.listAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <Group justify="space-between" mb="sm">
        <Text fw={700}>Agents</Text>
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
      <Stack gap="xs">
        {state.agentDtos.map((a) => (
          <Card key={a.id} withBorder padding="sm" radius="md">
            <Group justify="space-between" wrap="nowrap">
              <div style={{ minWidth: 0 }}>
                <Group gap={6}>
                  <Text fw={600} size="sm">{a.name}</Text>
                  {a.builtIn && <Badge size="xs" variant="light">built-in</Badge>}
                  {a.provider && <Badge size="xs" variant="outline">{a.provider}</Badge>}
                </Group>
                <Text size="xs" c="dimmed" lineClamp={2}>{a.description}</Text>
                <Text size="10px" c="dimmed" mt={4}>
                  tools: {a.tools === "all" ? "all" : `${a.tools.length}`} ·{" "}
                  {a.subAgents?.length ? `sub-agents: ${a.subAgents.length}` : "no sub-agents"}
                </Text>
              </div>
              <Button size="compact-xs" variant="light" onClick={() => setEditing({ ...a })}>
                {a.builtIn ? "View" : "Edit"}
              </Button>
              {!a.builtIn && (
                <Tooltip label="Export as JSON">
                  <Button size="compact-xs" variant="subtle" onClick={() => actions.exportAgent(a)}>
                    Export
                  </Button>
                </Tooltip>
              )}
            </Group>
          </Card>
        ))}
      </Stack>
    </ScrollArea>
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
  const allTools = draft.tools === "all";
  const readOnly = !!draft.builtIn;

  const toolOptions = state.toolCatalog.map((t) => ({
    value: t.name,
    label: `${t.name}${t.mutating ? " ✎" : ""}`,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveProviderId]);

  return (
    <ScrollArea className="panel-scroll">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={700}>{readOnly ? "Agent (read-only)" : draft.id ? "Edit agent" : "New agent"}</Text>
          <Button size="compact-xs" variant="subtle" onClick={onCancel}>← Back</Button>
        </Group>

        <TextInput
          label="Name"
          value={draft.name}
          disabled={readOnly}
          onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
        />
        <TextInput
          label="Description"
          value={draft.description}
          disabled={readOnly}
          onChange={(e) => setDraft({ ...draft, description: e.currentTarget.value })}
        />
        <Textarea
          label="System prompt"
          autosize
          minRows={3}
          maxRows={10}
          value={draft.systemPrompt}
          disabled={readOnly}
          onChange={(e) => setDraft({ ...draft, systemPrompt: e.currentTarget.value })}
        />

        <Switch
          label="Allow all tools"
          checked={allTools}
          disabled={readOnly}
          onChange={(e) =>
            setDraft({ ...draft, tools: e.currentTarget.checked ? "all" : [] })
          }
        />
        {!allTools && (
          <MultiSelect
            label="Allowed tools"
            data={toolOptions}
            value={draft.tools === "all" ? [] : draft.tools}
            disabled={readOnly}
            searchable
            onChange={(v) => setDraft({ ...draft, tools: v })}
          />
        )}

        <Group grow>
          <Select
            label="Provider override"
            data={providerOptions}
            value={draft.provider ?? ""}
            disabled={readOnly}
            onChange={(v) => setDraft({ ...draft, provider: v || undefined })}
          />
          <Autocomplete
            label="Model override"
            value={draft.model ?? ""}
            disabled={readOnly}
            placeholder="optional"
            data={modelOptions}
            limit={50}
            maxDropdownHeight={280}
            onChange={(v) => setDraft({ ...draft, model: v || undefined })}
            comboboxProps={{ withinPortal: true }}
          />
        </Group>

        <MultiSelect
          label="Always-on skills"
          data={skillOptions}
          value={draft.skills ?? []}
          disabled={readOnly}
          onChange={(v) => setDraft({ ...draft, skills: v })}
        />
        <MultiSelect
          label="Sub-agents (delegation)"
          description="Agents this one may hand off subtasks to."
          data={agentOptions}
          value={draft.subAgents ?? []}
          disabled={readOnly}
          onChange={(v) => setDraft({ ...draft, subAgents: v })}
        />

        {!readOnly && (
          <Group justify="space-between" mt="sm">
            {onDelete ? (
              <Button color="red" variant="light" size="xs" onClick={onDelete}>
                Delete
              </Button>
            ) : (
              <span />
            )}
            <Button size="xs" onClick={() => onSave(draft)} disabled={!draft.name.trim()}>
              Save
            </Button>
          </Group>
        )}
      </Stack>
    </ScrollArea>
  );
}
