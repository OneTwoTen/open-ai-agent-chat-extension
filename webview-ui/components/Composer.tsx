import { ActionIcon, Box, Group, Paper, Pill, Text, Textarea, Tooltip } from "@mantine/core";
import React, { useCallback, useRef, useState } from "react";
import { Attachment, FileRef } from "../../src/shared/protocol";
import { attachmentPreviewKind, attachmentShortName } from "./attachmentPreview";
import { attachmentFromClipboardFile } from "./pasteAttachments";

interface ComposerProps {
  busy: boolean;
  attachments: Attachment[];
  fileResults: FileRef[];
  onSend: (text: string) => void;
  onCancel: () => void;
  onAttachClick: () => void;
  onRemoveAttachment: (path: string) => void;
  onDropPaths: (paths: string[]) => void;
  onAddAttachments: (attachments: Attachment[]) => void;
  onSearchFiles: (query: string) => void;
  draft?: { id: number; text: string };
}

interface Mention {
  start: number;
  end: number;
  query: string;
}

const SLASH_COMMANDS = [
  { cmd: "/explain", desc: "Explain the selection / active file" },
  { cmd: "/fix", desc: "Find and fix issues" },
  { cmd: "/tests", desc: "Write tests" },
  { cmd: "/doc", desc: "Add documentation" },
  { cmd: "/clear", desc: "Start a new chat" },
];

const PARTICIPANTS = [
  { id: "@workspace", desc: "Use repository context and tools" },
  { id: "@terminal", desc: "Debug commands and terminal output" },
  { id: "@vscode", desc: "VS Code/editor-focused help" },
];

function parseUriList(data: string): string[] {
  return data
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      try {
        const u = new URL(l);
        if (u.protocol === "file:") {
          let p = decodeURIComponent(u.pathname);
          if (/^\/[a-zA-Z]:/.test(p)) {
            p = p.slice(1);
          }
          return p;
        }
      } catch {
        /* not a url */
      }
      return l;
    });
}

function detectMention(value: string, caret: number): Mention | null {
  const upto = value.slice(0, caret);
  const m = /(?:^|\s)#([^\s#]*)$/.exec(upto);
  if (!m) {
    return null;
  }
  return { start: caret - m[1].length - 1, end: caret, query: m[1] };
}

export function Composer({
  busy,
  attachments,
  fileResults,
  onSend,
  onCancel,
  onAttachClick,
  onRemoveAttachment,
  onDropPaths,
  onAddAttachments,
  onSearchFiles,
  draft,
}: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [dragging, setDragging] = useState(false);
  const [mention, setMention] = useState<Mention | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  React.useEffect(() => {
    if (draft) {
      setValue(draft.text);
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [draft?.id]);

  const slashMatch = /^\/(\w*)$/.exec(value);
  const participantMatch = /^@(\w*)$/.exec(value);
  const slashItems = slashMatch
    ? SLASH_COMMANDS.filter((c) => c.cmd.slice(1).startsWith(slashMatch[1].toLowerCase()))
    : [];
  const participantItems = participantMatch
    ? PARTICIPANTS.filter((p) => p.id.slice(1).startsWith(participantMatch[1].toLowerCase()))
    : [];
  const slashOpen = !!slashMatch && slashItems.length > 0;
  const participantOpen = !!participantMatch && participantItems.length > 0;
  const fileOpen = !slashMatch && !participantMatch && mention !== null && fileResults.length > 0;
  const listLen = slashOpen
    ? slashItems.length
    : participantOpen
    ? participantItems.length
    : fileOpen
    ? fileResults.length
    : 0;

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.currentTarget.value;
    setValue(next);
    setHighlight(0);
    if (/^[/@](\w*)$/.test(next)) {
      setMention(null);
      return;
    }
    const caret = e.currentTarget.selectionStart ?? next.length;
    const m = detectMention(next, caret);
    setMention(m);
    if (m) {
      onSearchFiles(m.query);
    }
  };

  const selectSlash = (cmd: string) => {
    setValue(cmd + " ");
    setMention(null);
    requestAnimationFrame(() => ref.current?.focus());
  };

  const selectParticipant = (id: string) => {
    setValue(id + " ");
    setMention(null);
    requestAnimationFrame(() => ref.current?.focus());
  };

  const selectMention = (item: FileRef) => {
    if (!mention) {
      return;
    }
    setValue(value.slice(0, mention.start) + value.slice(mention.end));
    setMention(null);
    onDropPaths([item.fsPath]);
    requestAnimationFrame(() => ref.current?.focus());
  };

  const send = () => {
    if ((!value.trim() && attachments.length === 0) || busy) {
      return;
    }
    onSend(value);
    setValue("");
    setMention(null);
  };

  const toggleRecording = useCallback(() => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    if (isRecording && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsRecording(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalTranscript = value;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }
      setValue(finalTranscript + interimTranscript);
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognition.start();
    setIsRecording(true);
  }, [isRecording, value]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (listLen > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % listLen);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + listLen) % listLen);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (slashOpen) {
          selectSlash(slashItems[highlight].cmd);
        } else if (participantOpen) {
          selectParticipant(participantItems[highlight].id);
        } else {
          selectMention(fileResults[highlight]);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const data =
      e.dataTransfer.getData("text/uri-list") ||
      e.dataTransfer.getData("application/vnd.code.uri-list") ||
      e.dataTransfer.getData("text/plain");
    if (data) {
      const paths = parseUriList(data);
      if (paths.length) {
        onDropPaths(paths);
      }
    }
  };

  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files ?? []).filter((file) => file.size > 0);
    if (files.length === 0) {
      return;
    }
    e.preventDefault();
    try {
      const now = Date.now();
      const pasted = await Promise.all(
        files.map((file, index) => attachmentFromClipboardFile(file, index, now))
      );
      onAddAttachments(pasted);
    } catch (err) {
      console.error("Could not read pasted file", err);
    }
  };

  return (
    <Box p="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
      {attachments.some((a) => attachmentPreviewKind(a) === "image") && (
        <Group gap={6} mb={6} wrap="wrap" align="flex-start">
          {attachments
            .filter((a) => attachmentPreviewKind(a) === "image")
            .map((a) => (
              <Box key={a.path} className="attachment-thumb">
                <img src={a.imageUrl} alt={attachmentShortName(a.path)} />
                <Tooltip label={attachmentShortName(a.path)} withArrow>
                  <Text size="10px" truncate className="attachment-thumb-label">
                    {attachmentShortName(a.path)}
                  </Text>
                </Tooltip>
                <ActionIcon
                  className="attachment-remove"
                  size="xs"
                  variant="filled"
                  color="dark"
                  radius="xl"
                  onClick={() => onRemoveAttachment(a.path)}
                  aria-label={`Remove ${attachmentShortName(a.path)}`}
                >
                  ×
                </ActionIcon>
              </Box>
            ))}
        </Group>
      )}
      {attachments.length > 0 && (
        <Pill.Group mb={6}>
          {attachments.map((a) => (
            <Pill key={a.path} withRemoveButton onRemove={() => onRemoveAttachment(a.path)}>
              📎 {a.path.split("/").pop()}
            </Pill>
          ))}
        </Pill.Group>
      )}

      <Box
        className={`composer-drop ${dragging ? "dragging" : ""}`}
        style={{ position: "relative" }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {(slashOpen || participantOpen || fileOpen) && (
          <Paper
            withBorder
            shadow="md"
            radius="md"
            style={{ position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 6, zIndex: 5, maxHeight: 240, overflowY: "auto" }}
          >
            {slashOpen
              ? slashItems.map((c, i) => (
                  <ListRow
                    key={c.cmd}
                    active={i === highlight}
                    onSelect={() => selectSlash(c.cmd)}
                    onHover={() => setHighlight(i)}
                    icon="⌘"
                    title={c.cmd}
                    sub={c.desc}
                  />
                ))
              : participantOpen
              ? participantItems.map((p, i) => (
                  <ListRow
                    key={p.id}
                    active={i === highlight}
                    onSelect={() => selectParticipant(p.id)}
                    onHover={() => setHighlight(i)}
                    icon="@"
                    title={p.id}
                    sub={p.desc}
                  />
                ))
              : fileResults.map((item, i) => (
                  <ListRow
                    key={item.fsPath}
                    active={i === highlight}
                    onSelect={() => selectMention(item)}
                    onHover={() => setHighlight(i)}
                    icon={item.kind === "folder" ? "📁" : "📄"}
                    title={item.path}
                  />
                ))}
          </Paper>
        )}

        <Group gap={6} align="flex-end" wrap="nowrap">
          <Tooltip label="Attach files" withArrow>
            <ActionIcon variant="subtle" size="lg" onClick={onAttachClick} aria-label="Attach">
              <PaperclipIcon />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={isRecording ? "Stop recording" : "Voice input"} withArrow>
            <ActionIcon
              variant={isRecording ? "filled" : "subtle"}
              color={isRecording ? "red" : undefined}
              size="lg"
              onClick={toggleRecording}
              aria-label="Voice input"
            >
              <MicIcon />
            </ActionIcon>
          </Tooltip>
          <Textarea
            ref={ref}
            autosize
            minRows={1}
            maxRows={8}
            style={{ flex: 1 }}
            placeholder="Ask anything. # context, / commands, @ participants, or drop files."
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          {busy ? (
            <Tooltip label="Stop" withArrow>
              <ActionIcon color="red" size="lg" onClick={onCancel} aria-label="Stop">
                <StopIcon />
              </ActionIcon>
            </Tooltip>
          ) : (
            <Tooltip label="Send (Enter)" withArrow>
              <ActionIcon
                size="lg"
                onClick={send}
                disabled={!value.trim() && attachments.length === 0}
                aria-label="Send"
              >
                <SendIcon />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Box>
      <Text size="10px" c="dimmed" mt={4}>
        Enter to send · Shift+Enter newline · paste/attach/drop files · # file · / commands
      </Text>
    </Box>
  );
}

function ListRow({
  active,
  onSelect,
  onHover,
  icon,
  title,
  sub,
}: {
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
  icon: string;
  title: string;
  sub?: string;
}) {
  return (
    <Box
      px="sm"
      py={4}
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
      onMouseEnter={onHover}
      style={{ cursor: "pointer", background: active ? "var(--mantine-color-default-hover)" : "transparent" }}
    >
      <Group gap={6} wrap="nowrap">
        <Text size="sm">{icon}</Text>
        <Text size="xs" fw={sub ? 600 : 400} style={{ whiteSpace: "nowrap" }}>
          {title}
        </Text>
        {sub && (
          <Text size="xs" c="dimmed" truncate>
            {sub}
          </Text>
        )}
      </Group>
    </Box>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3.4 20.4 21 12 3.4 3.6 3 10l12 2-12 2 .4 6.4Z" />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}
function PaperclipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}
