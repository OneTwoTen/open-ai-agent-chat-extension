/**
 * Central event bus for cross-module communication.
 * Primarily bridges Telegram bot activity to the VS Code webview UI.
 */

export interface TelegramActivityEvent {
  type: "messageReceived" | "turnStarted" | "turnCompleted" | "toolCalled" | "toolResult" | "error" | "fileChanged";
  chatId: number;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface TelegramSessionEvent {
  type: "sessionCreated" | "sessionUpdated" | "sessionReset";
  chatId: number;
  sessionId: string | null;
  agentId: string;
  timestamp: number;
}

type EventMap = {
  "telegram:activity": TelegramActivityEvent;
  "telegram:session": TelegramSessionEvent;
};

type EventHandler<T> = (event: T) => void;

class EventBus {
  private readonly listeners = new Map<string, Set<EventHandler<unknown>>>();

  on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): () => void {
    const key = event as string;
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(handler as EventHandler<unknown>);

    return () => {
      set?.delete(handler as EventHandler<unknown>);
    };
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const key = event as string;
    const set = this.listeners.get(key);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(data);
      } catch (err) {
        console.error(`[EventBus] Error in handler for "${key}":`, err);
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}

export const eventBus = new EventBus();
