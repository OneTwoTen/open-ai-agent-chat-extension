import { Box, Button, Group, Stack, Text } from "@mantine/core";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "../components/Composer";
import { MessageItem } from "../components/MessageItem";
import { ReferencesPanel } from "../components/ReferencesPanel";
import { UsageBar } from "../components/UsageBar";
import { WorkingSet } from "../components/WorkingSet";
import { Actions, ChatState } from "../controller";

const SUGGESTIONS = [
  "Explain the architecture of this project",
  "Find and fix TODOs in the codebase",
  "Add tests for the active file",
];

export function ChatPanel({ state, actions }: { state: ChatState; actions: Actions }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ id: number; text: string } | undefined>();

  // Extract tool calls for the current turn
  const currentToolCalls = useMemo(() => {
    // Get the last batch of tool calls (from the current assistant message)
    const toolCalls: { kind: "tool"; id: string; name: string; args: unknown; result?: string; status: "running" | "done" }[] = [];
    let foundAssistant = false;
    for (let i = state.items.length - 1; i >= 0; i--) {
      const item = state.items[i];
      if (item.kind === "assistant") {
        if (foundAssistant) break;
        foundAssistant = true;
      } else if (item.kind === "tool") {
        toolCalls.unshift(item);
      }
    }
    return toolCalls;
  }, [state.items]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [state.items, state.note]);

  const lastUser = useMemo(
    () => [...state.items].reverse().find((it) => it.kind === "user"),
    [state.items]
  );
  const lastAssistantIndex = useMemo(() => {
    for (let i = state.items.length - 1; i >= 0; i--) {
      if (state.items[i].kind === "assistant") {
        return i;
      }
    }
    return -1;
  }, [state.items]);
  const canSuggest = lastAssistantIndex >= 0 && !state.busy;

  return (
    <Box className="shell-body">
      <Box className="chat-messages" ref={scrollRef}>
        {state.items.length === 0 ? (
          <Stack align="center" justify="center" gap="sm" style={{ flex: 1 }} py="xl">
            <Text fz={28}>🤖</Text>
            <Text fw={700}>AI Agent Chat</Text>
            <Text size="sm" c="dimmed" ta="center" maw={280}>
              A multi-provider coding agent with file edits, three-tier search, MCP tools, and
              command execution.
            </Text>
            <Stack gap={6} mt="sm" w="100%" maw={300}>
              {SUGGESTIONS.map((s) => (
                <Button key={s} variant="default" size="xs" onClick={() => actions.send(s)}>
                  {s}
                </Button>
              ))}
            </Stack>
            <Group gap={6} mt="xs">
              <Text size="xs" c="dimmed">
                Semantic index: {state.indexSize > 0 ? `${state.indexSize} chunks` : "not built"}
              </Text>
              <Button variant="subtle" size="compact-xs" onClick={actions.buildIndex}>
                {state.indexSize > 0 ? "Rebuild" : "Build"}
              </Button>
            </Group>
          </Stack>
        ) : (
          state.items.map((it, i) => (
            <MessageItem
              key={i}
              item={it}
              onEdit={
                it.kind === "user"
                  ? (text) => setDraft({ id: Date.now(), text })
                  : undefined
              }
              onRegenerate={
                i === lastAssistantIndex && lastUser?.kind === "user" && !state.busy
                  ? () => actions.send(lastUser.text)
                  : undefined
              }
            />
          ))
        )}

        {canSuggest && (
          <Group gap={6} ml={32} mb="xs" wrap="wrap">
            {["Tóm tắt ngắn gọn", "Đề xuất bước tiếp theo", "Tạo tests cho thay đổi này"].map((s) => (
              <Button key={s} size="compact-xs" variant="default" onClick={() => actions.send(s)}>
                {s}
              </Button>
            ))}
          </Group>
        )}

        {state.busy && !state.note && (
          <Box className="msg-row">
            <Box style={{ width: 24 }} />
            <span className="typing">
              <span />
              <span />
              <span />
            </span>
          </Box>
        )}
        {state.note && (
          <Text size="xs" c="dimmed" fs="italic">
            {state.note}
          </Text>
        )}
      </Box>

      <UsageBar usage={state.usage} provider={state.provider} model={state.model} />
      
      <Box px="sm" pt={6}>
        <ReferencesPanel toolCalls={currentToolCalls} />
      </Box>

      <Group gap={6} px="sm" pt={6} wrap="wrap">
        <Button size="compact-xs" variant="default" onClick={() => actions.addContext("selection")}>
          + Selection
        </Button>
        <Button size="compact-xs" variant="default" onClick={() => actions.addContext("editor")}>
          + File
        </Button>
        <Button size="compact-xs" variant="default" onClick={() => actions.addContext("problems")}>
          + Problems
        </Button>
        <Button size="compact-xs" variant="default" onClick={() => actions.addContext("changes")}>
          + Changes
        </Button>
        <span style={{ flex: 1 }} />
        <Button
          size="compact-xs"
          variant="light"
          disabled={state.busy}
          onClick={() => actions.analyzeSessions([])}
        >
          Analyze chat
        </Button>
      </Group>

      <Box px="sm" pt={6}>
        <WorkingSet files={state.workingSet} />
      </Box>

      <Composer
        busy={state.busy}
        attachments={state.attachments}
        fileResults={state.fileResults}
        onSend={actions.send}
        onCancel={actions.cancel}
        onAttachClick={actions.pickFiles}
        onRemoveAttachment={actions.removeAttachment}
        onDropPaths={actions.dropPaths}
        onAddAttachments={actions.addAttachments}
        onSearchFiles={actions.searchFiles}
        draft={draft}
      />
    </Box>
  );
}
