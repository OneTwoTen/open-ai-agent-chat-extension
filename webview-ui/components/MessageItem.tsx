import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  CopyButton,
  Group,
  Paper,
  Text,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React from "react";
import { ChatItem } from "../controller";
import { MarkdownLite } from "./MarkdownLite";
import { ToolCallView } from "./ToolCallView";

const AVATAR_SIZE = 24;

export function MessageItem({
  item,
  onEdit,
  onRegenerate,
}: {
  item: ChatItem;
  onEdit?: (text: string) => void;
  onRegenerate?: () => void;
}) {
  switch (item.kind) {
    case "user":
      return (
        <Box className="msg-row">
          <ThemeIcon size={AVATAR_SIZE} radius="xl" variant="filled">
            <UserIcon />
          </ThemeIcon>
          <Box className="msg-body">
            <Paper withBorder radius="md" p="xs" style={{ background: "var(--vscode-input-background)" }}>
              <Text className="msg-text" size="sm">{item.text}</Text>
            </Paper>
            {onEdit && (
              <Group gap={4} mt={3}>
                <Tooltip label="Edit and resend" withArrow>
                  <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => onEdit(item.text)} aria-label="Edit message">
                    <EditIcon />
                  </ActionIcon>
                </Tooltip>
              </Group>
            )}
            {item.attachments && item.attachments.length > 0 && (
              <Group gap={4} mt={4}>
                {item.attachments.map((a) => (
                  <Badge key={a} size="xs" variant="light" leftSection="📎">
                    {a.split("/").pop()}
                  </Badge>
                ))}
              </Group>
            )}
          </Box>
        </Box>
      );

    case "assistant":
      return (
        <Box className="msg-row">
          <ThemeIcon size={AVATAR_SIZE} radius="xl" variant="light" color="grape">
            <BotIcon />
          </ThemeIcon>
          <Box className="msg-body">
            {item.reasoning.trim() && <ReasoningBlock text={item.reasoning} />}
            <Box className="msg-text">
              <MarkdownLite text={item.text} />
            </Box>
            <Group gap={6} mt={3} align="center">
              {item.model && (
                <Badge size="xs" variant="light" color="gray" style={{ textTransform: "none" }}>
                  {item.model}
                </Badge>
              )}
              {item.text.trim() && (
                <CopyButton value={item.text} timeout={1500}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? "Copied" : "Copy reply"} withArrow>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="gray"
                        onClick={copy}
                        aria-label="Copy reply"
                      >
                        {copied ? <CheckIcon /> : <CopyIcon />}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
              )}
              {onRegenerate && item.text.trim() && (
                <Tooltip label="Regenerate from last prompt" withArrow>
                  <ActionIcon size="sm" variant="subtle" color="gray" onClick={onRegenerate} aria-label="Regenerate reply">
                    <RefreshIcon />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          </Box>
        </Box>
      );

    case "tool":
      return (
        <Box className="msg-row">
          <Box style={{ width: AVATAR_SIZE, flexShrink: 0 }} />
          <Box className="msg-body">
            <ToolCallView item={item} />
          </Box>
        </Box>
      );

    case "error":
      return (
        <Box className="msg-row">
          <ThemeIcon size={AVATAR_SIZE} radius="xl" variant="light" color="red">
            !
          </ThemeIcon>
          <Box className="msg-body">
            <Alert color="red" variant="light" p="xs">
              <Text size="sm">{item.text}</Text>
            </Alert>
          </Box>
        </Box>
      );
  }
}

function ReasoningBlock({ text }: { text: string }) {
  const [open, { toggle }] = useDisclosure(false);
  return (
    <Paper withBorder radius="md" mb={6} style={{ background: "transparent" }}>
      <UnstyledButton onClick={toggle} px="xs" py={4} style={{ width: "100%" }}>
        <Group gap={6}>
          <Text size="xs">💭</Text>
          <Text size="xs" c="dimmed" fw={600}>
            Reasoning {open ? "▲" : "▼"}
          </Text>
        </Group>
      </UnstyledButton>
      {open && (
        <Text size="xs" c="dimmed" px="xs" pb="xs" style={{ whiteSpace: "pre-wrap" }}>
          {text}
        </Text>
      )}
    </Paper>
  );
}

function UserIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}
function BotIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 8V4" />
      <circle cx="9" cy="14" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="14" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}
