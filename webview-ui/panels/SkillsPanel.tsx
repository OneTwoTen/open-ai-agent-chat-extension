import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from "@mantine/core";
import React, { useEffect, useMemo, useState } from "react";
import { SkillDTO } from "../../src/shared/protocol";
import { Actions, ChatState } from "../controller";

function blankSkill(): SkillDTO {
  return {
    name: "",
    description: "",
    alwaysApply: false,
    body: "# New skill\n\nDescribe the workflow.",
  };
}

type EditorTab = "edit" | "preview";

export function SkillsPanel({ state, actions }: { state: ChatState; actions: Actions }) {
  const [editing, setEditing] = useState<SkillDTO | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "always" | "conditional">("all");

  useEffect(() => {
    actions.listSkills();
  }, []);

  const filteredSkills = useMemo(() => {
    let skills = state.skills;
    if (filterType === "always") skills = skills.filter((s) => s.alwaysApply);
    if (filterType === "conditional") skills = skills.filter((s) => !s.alwaysApply);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      skills = skills.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.description && s.description.toLowerCase().includes(q))
      );
    }
    return skills;
  }, [state.skills, filterType, searchQuery]);

  if (editing) {
    return (
      <SkillEditor
        skill={editing}
        actions={actions}
        onCancel={() => setEditing(null)}
        onSave={(s) => {
          actions.saveSkill(s);
          setEditing(null);
        }}
        onDelete={() => {
          if (editing.name) {
            actions.deleteSkill(editing.name);
          }
          setEditing(null);
        }}
      />
    );
  }

  return (
    <ScrollArea className="panel-scroll">
      <Stack gap="md">
        <Group justify="space-between">
          <Text fw={700} size="lg">
            Skills
          </Text>
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

        <TextInput
          placeholder="Search skills..."
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
            { label: "Always", value: "always" },
            { label: "Conditional", value: "conditional" },
          ]}
          value={filterType}
          onChange={(v) => setFilterType(v as typeof filterType)}
        />

        <Stack gap="xs">
          {filteredSkills.length === 0 && (
            <Paper p="md" ta="center" c="dimmed" withBorder>
              <Text size="sm">No skills found</Text>
            </Paper>
          )}
          {filteredSkills.map((s) => (
            <SkillCard
              key={s.name}
              skill={s}
              onEdit={() => setEditing({ ...s })}
              actions={actions}
            />
          ))}
        </Stack>
      </Stack>
    </ScrollArea>
  );
}

function SkillCard({
  skill,
  onEdit,
  actions,
}: {
  skill: SkillDTO;
  onEdit: () => void;
  actions: Actions;
}) {
  const hasVersion = skill.version && skill.version > 1;
  const bodyPreview = skill.body
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .slice(0, 2)
    .join(" ")
    .slice(0, 120);

  return (
    <Card
      className="skill-card"
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
              {skill.name}
            </Text>
            {skill.alwaysApply && (
              <Badge size="xs" variant="light" color="green">
                always
              </Badge>
            )}
            {hasVersion && (
              <Badge size="xs" variant="outline" color="gray">
                v{skill.version}
              </Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed" lineClamp={2} mb={6}>
            {skill.description || bodyPreview || "No description"}
          </Text>
          <Group gap={6}>
            <Text size="10px" c="dimmed">
              {skill.body.length} chars
            </Text>
            <Text size="10px" c="dimmed">
              {skill.body.split("\n").length} lines
            </Text>
          </Group>
        </div>
        <Group gap={4} onClick={(e) => e.stopPropagation()}>
          <Tooltip label="Edit">
            <ActionIcon variant="light" size="sm" onClick={onEdit}>
              <PencilIcon />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Export as .md">
            <ActionIcon variant="subtle" size="sm" onClick={() => actions.exportSkill(skill)}>
              <DownloadIcon />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </Card>
  );
}

function SkillEditor({
  skill,
  actions,
  onCancel,
  onSave,
  onDelete,
}: {
  skill: SkillDTO;
  actions: Actions;
  onCancel: () => void;
  onSave: (s: SkillDTO) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<SkillDTO>(skill);
  const [editorTab, setEditorTab] = useState<EditorTab>("edit");

  const updateDraft = (patch: Partial<SkillDTO>) => setDraft((d) => ({ ...d, ...patch }));

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
              {draft.name ? `Edit skill` : "New skill"}
            </Text>
          </Group>
          <Group gap={4}>
            <Tooltip label="Delete skill">
              <ActionIcon color="red" variant="light" onClick={onDelete}>
                <TrashIcon />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Export as .md">
              <ActionIcon variant="subtle" onClick={() => actions.exportSkill(draft)}>
                <DownloadIcon />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        <Stack gap="sm">
          <TextInput
            label="Name"
            description="Unique identifier (lowercase, hyphen-separated)"
            value={draft.name}
            onChange={(e) => updateDraft({ name: e.currentTarget.value })}
            placeholder="e.g., code-review"
          />
          <TextInput
            label="Description"
            description="What this skill does and when to use it"
            value={draft.description}
            onChange={(e) => updateDraft({ description: e.currentTarget.value })}
            placeholder="e.g., Use when reviewing code for quality..."
          />
          <Switch
            label="Always apply"
            description="Inject into every conversation turn"
            checked={draft.alwaysApply}
            onChange={(e) => updateDraft({ alwaysApply: e.currentTarget.checked })}
          />
        </Stack>

        <Divider />

        <SegmentedControl
          size="xs"
          fullWidth
          data={[
            { label: "Edit", value: "edit" },
            { label: "Preview", value: "preview" },
          ]}
          value={editorTab}
          onChange={(v) => setEditorTab(v as EditorTab)}
        />

        {editorTab === "edit" ? (
          <Textarea
            label="Instructions (markdown)"
            description="Define the skill's workflow and behavior"
            autosize
            minRows={8}
            maxRows={24}
            value={draft.body}
            onChange={(e) => updateDraft({ body: e.currentTarget.value })}
          />
        ) : (
          <Paper p="md" withBorder className="skill-preview">
            <div
              className="md"
              dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(draft.body) }}
            />
          </Paper>
        )}

        <Group justify="flex-end" mt="sm">
          <Button variant="light" size="xs" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="xs" disabled={!draft.name.trim()} onClick={() => onSave(draft)}>
            Save skill
          </Button>
        </Group>
      </Stack>
    </ScrollArea>
  );
}

/** Simple markdown renderer for preview (headings, bold, italic, code, lists) */
function renderSimpleMarkdown(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (line.startsWith("# ")) return `<h3 style="margin:8px 0 4px">${line.slice(2)}</h3>`;
      if (line.startsWith("## ")) return `<h4 style="margin:6px 0 4px">${line.slice(3)}</h4>`;
      if (line.startsWith("### ")) return `<h5 style="margin:4px 0 2px">${line.slice(4)}</h5>`;
      if (line.startsWith("- ")) return `<li style="margin-left:16px">${line.slice(2)}</li>`;
      if (line.startsWith("```")) return `<code style="display:block;padding:8px;background:rgba(128,128,128,0.1);border-radius:4px;margin:4px 0">`;
      return line
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.*?)\*/g, "<em>$1</em>")
        .replace(/`(.*?)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br/>");
    })
    .join("\n");
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
