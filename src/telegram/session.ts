import { AgentSession } from "../agent/agent";
import type { PendingConfirm, TelegramChatSession } from "./types";

export class TelegramSessionManager {
  private readonly sessions = new Map<number, TelegramChatSession>();
  private readonly pendingConfirms = new Map<string, PendingConfirm>();

  getOrCreate(chatId: number): TelegramChatSession {
    let s = this.sessions.get(chatId);
    if (!s) {
      s = {
        chatId,
        agentSession: new AgentSession(),
        state: "idle",
        agentId: "coder",
        workspacePath: "",
        streamingMessageId: null,
        streamingText: "",
        abortController: null,
        queue: [],
        createdAt: Date.now(),
        sessionId: null,
        transcript: [],
      };
      this.sessions.set(chatId, s);
    }
    return s;
  }

  get(chatId: number): TelegramChatSession | undefined {
    return this.sessions.get(chatId);
  }

  delete(chatId: number): void {
    const s = this.sessions.get(chatId);
    if (s) {
      s.abortController?.abort();
      this.sessions.delete(chatId);
    }
  }

  reset(chatId: number): void {
    const s = this.sessions.get(chatId);
    if (s) {
      s.agentSession.reset();
      s.streamingMessageId = null;
      s.streamingText = "";
      s.abortController = null;
      s.queue = [];
      s.state = "idle";
      s.sessionId = null;
      s.transcript = [];
    }
  }

  /** Add a pending confirmation for inline-keyboard approval. */
  addConfirm(key: string, pc: PendingConfirm): void {
    this.cleanExpiredConfirms();
    this.pendingConfirms.set(key, pc);
  }

  /** Resolve a pending confirmation. Returns false if already expired. */
  resolveConfirm(key: string, value: boolean): boolean {
    const pc = this.pendingConfirms.get(key);
    if (!pc) {
      return false;
    }
    clearTimeout(pc.timeout);
    this.pendingConfirms.delete(key);
    pc.resolve(value);
    return true;
  }

  chatCount(): number {
    return this.sessions.size;
  }

  dispose(): void {
    for (const s of this.sessions.values()) {
      s.abortController?.abort();
    }
    this.sessions.clear();
    for (const [, pc] of this.pendingConfirms) {
      clearTimeout(pc.timeout);
      pc.reject(new Error("Bot shutting down"));
    }
    this.pendingConfirms.clear();
  }

  private cleanExpiredConfirms(): void {
    const now = Date.now();
    for (const [key, pc] of this.pendingConfirms) {
      if (now >= (pc as unknown as { expiresAt: number }).expiresAt) {
        clearTimeout(pc.timeout);
        pc.reject(new Error("Confirmation timed out"));
        this.pendingConfirms.delete(key);
      }
    }
  }
}
