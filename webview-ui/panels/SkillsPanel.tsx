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
  Textarea,
  Tooltip,
} from "@mantine/core";
import React, { useEffect, useState } from "react";
import { SkillDTO } from "../../src/shared/protocol";
import { Actions, ChatState } from "../controller";

function blankSkill(): SkillDTO {
  return { name: "", description: "", alwaysApply: false, body: "# New skill\n\nDescribe the workflow." };
}

export function SkillsPanel({ state, actions }: { state: ChatState; actions: Actions }) {
  const [editing, setEditing] = useState<SkillDTO | null>(null);

  useEffect(() => {
    actions.listSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (editing) {
    return (
      <ScrollArea className="panel-scroll">
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={700}>{editing.name ? "Edit skill" : "New skill"}</Text>
            <Button size="compact-xs" variant="subtle" onClick={() => setEditing(null)}>
              ← Back
            </Button>
          </Group>
          <TextInput
            label="Name"
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.currentTarget.value })}
          />
          <TextInput
            label="Description"
            value={editing.description}
            onChange={(e) => setEditing({ ...editing, description: e.currentTarget.value })}
          />
          <Switch
            label="Always apply (inject into every turn)"
            checked={editing.alwaysApply}
            onChange={(e) => setEditing({ ...editing, alwaysApply: e.currentTarget.checked })}
          />
          <Textarea
            label="Instructions (markdown)"
            autosize
            minRows={6}
            maxRows={20}
            value={editing.body}
            onChange={(e) => setEditing({ ...editing, body: e.currentTarget.value })}
          />
          <Group justify="space-between" mt="sm">
            <Button
              color="red"
              variant="light"
              size="xs"
              onClick={() => {
                if (editing.name) {
                  actions.deleteSkill(editing.name);
                }
                setEditing(null);
              }}
            >
              Delete
            </Button>
            <Button
              size="xs"
              disabled={!editing.name.trim()}
              onClick={() => {
                actions.saveSkill(editing);
                setEditing(null);
              }}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="panel-scroll">
      <Group justify="space-between" mb="sm">
        <Text fw={700}>Skills</Text>
        <Group gap={4}>
          <Tooltip label="Import skill from file">
            <Button size="xs" variant="subtle" onClick={() => actions.importSkill()}>
              Import
            </Button>
          </Tooltip>
          <Button size="xs" onClick={() => setEditing(blankSkill())}>
            + New skill
          </Button>
        </Group>
      </Group>
      <Stack gap="xs">
        {state.skills.length === 0 && (
          <Text size="sm" c="dimmed">
            No skills yet. Skills are reusable instructions stored in .agentchat/skills.
          </Text>
        )}
        {state.skills.map((s) => (
          <Card key={s.name} withBorder padding="sm" radius="md">
            <Group justify="space-between" wrap="nowrap">
              <div style={{ minWidth: 0 }}>
                <Group gap={6}>
                  <Text fw={600} size="sm">{s.name}</Text>
                  {s.alwaysApply && <Badge size="xs" color="green" variant="light">always</Badge>}
                  {s.version && s.version > 1 && (
                    <Badge size="xs" variant="outline">v{s.version}</Badge>
                  )}
                </Group>
                <Text size="xs" c="dimmed" lineClamp={2}>{s.description || s.body}</Text>
              </div>
              <Button size="compact-xs" variant="light" onClick={() => setEditing({ ...s })}>
                Edit
              </Button>
              <Tooltip label="Export as .md">
                <Button size="compact-xs" variant="subtle" onClick={() => actions.exportSkill(s)}>
                  Export
                </Button>
              </Tooltip>
            </Group>
          </Card>
        ))}
      </Stack>
    </ScrollArea>
  );
}
