import { AgentSession } from "../agent/agent";
import type { Context } from "grammy";
import type { Attachment } from "../shared/protocol";

export type SessionState = "idle" | "running" | "waiting_confirm";

export interface QueuedRequest {
  text: string;
  attachments: Attachment[];
  resolve: () => void;
}

export interface PendingConfirm {
  chatId: number;
  messageId: number;
  resolve: (value: boolean) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface TelegramChatSession {
  chatId: number;
  agentSession: AgentSession;
  state: SessionState;
  agentId: string;
  /** Per-chat workspace override; empty = use default from config */
  workspacePath: string;
  streamingMessageId: number | null;
  streamingText: string;
  abortController: AbortController | null;
  queue: QueuedRequest[];
  createdAt: number;
}

export interface TelegramBotConfig {
  token: string;
  allowedChatIds: number[];
  workspacePath: string;
  startOnActivation: boolean;
}

export interface TelegramBotStatus {
  running: boolean;
  chatCount: number;
  uptime: number;
  allowedChatIds: number[];
  workspacePath: string;
}

export type GrammyContext = Context;
