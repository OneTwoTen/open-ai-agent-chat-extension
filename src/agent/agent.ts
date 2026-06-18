import {
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { UsageStats } from "../shared/protocol";

type StreamTextProviderOptions = Parameters<typeof streamText>[0]["providerOptions"];

/** Callbacks the agent uses to stream progress to the UI. */
export interface AgentCallbacks {
  onTextDelta(text: string): void;
  onReasoningDelta(text: string): void;
  onToolCall(id: string, name: string, args: unknown): void;
  onToolResult(id: string, name: string, result: unknown): void;
  onStepUsage(tools: string[], usage: UsageStats): void;
  onFinalUsage(usage: UsageStats): void;
  onError(message: string): void;
  onDone(): void;
}

/** Image attachment for multimodal content. */
export interface ImageAttachment {
  imageUrl: string;
  mimeType?: string;
}

export interface RunOptions {
  model: LanguageModel;
  systemMessage: ModelMessage;
  tools: ToolSet;
  userText: string;
  images?: ImageAttachment[];
  maxSteps: number;
  maxOutputTokens?: number;
  providerOptions?: Record<string, Record<string, unknown>>;
  callbacks: AgentCallbacks;
  signal: AbortSignal;
}

/**
 * Holds the conversation for one chat session and runs turns through the
 * Vercel AI SDK. The SDK drives the tool-calling loop (stopWhen); this class
 * assembles input, streams output, tracks usage, and keeps history.
 *
 * For prompt-cache friendliness the system message is kept out of `messages`
 * and re-supplied as a stable prefix on every turn.
 */
export class AgentSession {
  private messages: ModelMessage[] = [];

  reset(): void {
    this.messages = [];
  }

  getHistory(): ModelMessage[] {
    return this.messages;
  }

  setHistory(messages: ModelMessage[]): void {
    this.messages = messages;
  }

  async run(opts: RunOptions): Promise<void> {
    // Build user message content with support for images
    let userContent: string | Array<{ type: "text"; text: string } | { type: "image"; image: string; mimeType?: string }>;
    
    if (opts.images && opts.images.length > 0) {
      // Multimodal content with images
      userContent = [
        { type: "text", text: opts.userText },
        ...opts.images.map((img) => ({
          type: "image" as const,
          image: img.imageUrl,
          mimeType: img.mimeType,
        })),
      ];
    } else {
      // Plain text content
      userContent = opts.userText;
    }
    
    this.messages.push({ role: "user", content: userContent });

    try {
      const result = streamText({
        model: opts.model,
        messages: [opts.systemMessage, ...this.messages],
        tools: opts.tools,
        stopWhen: stepCountIs(opts.maxSteps),
        abortSignal: opts.signal,
        maxOutputTokens: opts.maxOutputTokens,
        providerOptions: opts.providerOptions as StreamTextProviderOptions,
        onStepFinish: (step) => {
          const toolNames = (step.toolCalls ?? []).map((t) => t.toolName);
          opts.callbacks.onStepUsage(toolNames, toUsage(step.usage));
        },
      });

      for await (const part of result.fullStream) {
        switch (part.type) {
          case "text-delta":
            opts.callbacks.onTextDelta(part.text);
            break;
          case "reasoning-delta":
            opts.callbacks.onReasoningDelta(part.text);
            break;
          case "tool-call":
            opts.callbacks.onToolCall(part.toolCallId, part.toolName, part.input);
            break;
          case "tool-result":
            opts.callbacks.onToolResult(part.toolCallId, part.toolName, part.output);
            break;
          case "error":
            opts.callbacks.onError(stringifyError(part.error));
            break;
          default:
            break;
        }
      }

      const response = await result.response;
      this.messages.push(...response.messages);
      opts.callbacks.onFinalUsage(toUsage(await result.totalUsage));
      opts.callbacks.onDone();
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e?.name === "AbortError") {
        opts.callbacks.onError("Request cancelled.");
      } else {
        opts.callbacks.onError(e?.message ?? String(err));
      }
    }
  }
}

interface RawUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export function toUsage(u: RawUsage | undefined): UsageStats {
  return {
    inputTokens: u?.inputTokens ?? 0,
    outputTokens: u?.outputTokens ?? 0,
    cachedInputTokens: u?.cachedInputTokens ?? 0,
    reasoningTokens: u?.reasoningTokens ?? 0,
    totalTokens: u?.totalTokens ?? 0,
  };
}

export function addUsage(a: UsageStats, b: UsageStats): UsageStats {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return JSON.stringify(error);
}
