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

/** Simple string hash for fingerprinting (djb2). */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return hash;
}

/** Normalize args for comparison: sort keys, strip whitespace. */
function normalizeArgs(args: unknown): string {
  if (args === undefined || args === null) return "";
  if (typeof args === "string") return args.trim();
  try {
    return JSON.stringify(args, Object.keys(args as Record<string, unknown>).sort());
  } catch {
    return JSON.stringify(args);
  }
}

/**
 * Advanced loop detection state with multiple detection strategies:
 *
 * 1. Consecutive identical: A->A->A (immediate repetition)
 * 2. Cyclic pattern:      A->B->A->B (periodic cycle of any length)
 * 3. Semantic similarity:  Same tool + similar args across non-consecutive calls
 * 4. Token burn rate:     Runaway token consumption without progress
 * 5. Tool frequency:      Excessive calls to the same tool in a window
 * 6. Reasoning hash:      Repeated reasoning content (model stuck in thought loop)
 */
interface AdvancedLoopDetectionState {
  // --- Strategy 1: Consecutive identical ---
  consecutiveIdentical: number;
  maxConsecutiveIdentical: number;

  // --- Strategy 2: Cyclic pattern detection ---
  /** Sliding window of recent call signatures (toolName:argsHash) */
  patternBuffer: string[];
  maxPatternBuffer: number;

  // --- Strategy 3: Semantic similarity ---
  /** Map of toolName -> array of { argsHash, resultHash, timestamp } */
  callHistory: Map<string, Array<{ argsHash: number; resultHash: number; ts: number }>>;
  /** Max history per tool before pruning */
  maxHistoryPerTool: number;

  // --- Strategy 4: Token burn rate ---
  /** Token usage per step */
  tokenBurnRate: number[];
  /** Running average window */
  burnRateWindow: number;
  /** Threshold: if burn rate > N * average, flag anomaly */
  burnRateThreshold: number;

  // --- Strategy 5: Tool frequency ---
  /** Timestamps of calls per tool in current window */
  toolFrequency: Map<string, number[]>;
  /** Window size in ms */
  frequencyWindowMs: number;
  /** Max calls per tool per window */
  maxCallsPerWindow: number;

  // --- Strategy 6: Reasoning loop ---
  /** Rolling hash of reasoning content per step */
  reasoningHashes: number[];
  /** Max consecutive similar reasoning hashes before flag */
  maxConsecutiveSimilarReasoning: number;

  // --- Shared ---
  stepCount: number;
  lastAbortReason: string | null;
}

function createAdvancedLoopState(opts: {
  maxConsecutiveIdentical?: number;
  maxPatternBuffer?: number;
  maxHistoryPerTool?: number;
  burnRateWindow?: number;
  burnRateThreshold?: number;
  frequencyWindowMs?: number;
  maxCallsPerWindow?: number;
  maxConsecutiveSimilarReasoning?: number;
}): AdvancedLoopDetectionState {
  return {
    consecutiveIdentical: 0,
    maxConsecutiveIdentical: opts.maxConsecutiveIdentical ?? 3,

    patternBuffer: [],
    maxPatternBuffer: opts.maxPatternBuffer ?? 20,

    callHistory: new Map(),
    maxHistoryPerTool: opts.maxHistoryPerTool ?? 20,

    tokenBurnRate: [],
    burnRateWindow: opts.burnRateWindow ?? 5,
    burnRateThreshold: opts.burnRateThreshold ?? 3.0,

    toolFrequency: new Map(),
    frequencyWindowMs: opts.frequencyWindowMs ?? 60_000,
    maxCallsPerWindow: opts.maxCallsPerWindow ?? 15,

    reasoningHashes: [],
    maxConsecutiveSimilarReasoning: opts.maxConsecutiveSimilarReasoning ?? 4,

    stepCount: 0,
    lastAbortReason: null,
  };
}

// ─── Detection helpers ──────────────────────────────────────────────

function detectConsecutiveIdentical(
  state: AdvancedLoopDetectionState,
  callSignature: string
): string | null {
  if (state.patternBuffer.length > 0 &&
      state.patternBuffer[state.patternBuffer.length - 1] === callSignature) {
    state.consecutiveIdentical++;
    if (state.consecutiveIdentical >= state.maxConsecutiveIdentical) {
      return `Tool called ${state.consecutiveIdentical} times consecutively with identical arguments`;
    }
  } else {
    state.consecutiveIdentical = 0;
  }
  return null;
}

function detectCyclicPattern(state: AdvancedLoopDetectionState): string | null {
  const buf = state.patternBuffer;
  if (buf.length < 4) return null;

  // Check for repeating cycles of length 2..N/2
  for (let cycleLen = 2; cycleLen <= Math.floor(buf.length / 2); cycleLen++) {
    let isCycle = true;
    for (let i = 0; i < cycleLen; i++) {
      if (buf[buf.length - 1 - i] !== buf[buf.length - 1 - cycleLen - i]) {
        isCycle = false;
        break;
      }
    }
    if (isCycle) {
      // Verify at least 2 full cycles
      const cycleSignature = buf.slice(-cycleLen).join("|");
      const fullCycles = buf.slice(-cycleLen * 2, -cycleLen).join("|");
      if (cycleSignature === fullCycles) {
        return `Cyclic pattern detected: [${buf.slice(-cycleLen).join(" → ")}] repeating`;
      }
    }
  }
  return null;
}

function detectSemanticSimilarity(
  state: AdvancedLoopDetectionState,
  toolName: string,
  argsHash: number,
  resultHash: number
): string | null {
  if (!state.callHistory.has(toolName)) {
    state.callHistory.set(toolName, []);
  }
  const history = state.callHistory.get(toolName)!;

  // Check if same tool + same args + same result occurred recently
  const recentMatch = history.find(
    (h) => h.argsHash === argsHash && h.resultHash === resultHash
  );
  if (recentMatch) {
    return `Tool "${toolName}" called with identical arguments and produced identical result`;
  }

  // Check if same tool + similar args (within tolerance) occurred frequently
  const similarCount = history.filter((h) => h.argsHash === argsHash).length;
  if (similarCount >= 3) {
    return `Tool "${toolName}" called ${similarCount + 1} times with identical arguments across steps`;
  }

  return null;
}

function detectTokenBurnAnomaly(
  state: AdvancedLoopDetectionState,
  totalTokens: number
): string | null {
  state.tokenBurnRate.push(totalTokens);

  if (state.tokenBurnRate.length < state.burnRateWindow + 1) return null;

  // Calculate average burn rate over last N steps
  const recentRates: number[] = [];
  for (let i = 1; i < state.tokenBurnRate.length; i++) {
    recentRates.push(state.tokenBurnRate[i] - state.tokenBurnRate[i - 1]);
  }

  if (recentRates.length < state.burnRateWindow) return null;

  const windowRates = recentRates.slice(-state.burnRateWindow);
  const avgRate = windowRates.reduce((a, b) => a + b, 0) / windowRates.length;
  const currentRate = windowRates[windowRates.length - 1];

  // If current rate is much higher than average (and average is non-trivial)
  if (avgRate > 100 && currentRate > avgRate * state.burnRateThreshold) {
    return `Token burn rate anomaly: ${currentRate} tokens/step vs ${Math.round(avgRate)} avg`;
  }

  return null;
}

function detectToolFrequencyAnomaly(
  state: AdvancedLoopDetectionState,
  toolName: string,
  now: number
): string | null {
  if (!state.toolFrequency.has(toolName)) {
    state.toolFrequency.set(toolName, []);
  }
  const timestamps = state.toolFrequency.get(toolName)!;
  timestamps.push(now);

  // Prune old timestamps outside window
  const cutoff = now - state.frequencyWindowMs;
  while (timestamps.length > 0 && timestamps[0] < cutoff) {
    timestamps.shift();
  }

  if (timestamps.length > state.maxCallsPerWindow) {
    return `Tool "${toolName}" called ${timestamps.length} times within ${state.frequencyWindowMs / 1000}s window (limit: ${state.maxCallsPerWindow})`;
  }

  // Also check total calls across ALL tools in the window
  let totalInWindow = 0;
  for (const [, ts] of state.toolFrequency) {
    totalInWindow += ts.filter((t) => t > cutoff).length;
  }
  if (totalInWindow > state.maxCallsPerWindow * 2) {
    return `Total tool calls in window: ${totalInWindow} (limit: ${state.maxCallsPerWindow * 2})`;
  }

  return null;
}

function detectReasoningLoop(
  state: AdvancedLoopDetectionState,
  reasoningContent: string
): string | null {
  if (!reasoningContent || reasoningContent.trim().length === 0) return null;

  const hash = hashString(reasoningContent.trim());
  state.reasoningHashes.push(hash);

  if (state.reasoningHashes.length < state.maxConsecutiveSimilarReasoning) return null;

  const recent = state.reasoningHashes.slice(-state.maxConsecutiveSimilarReasoning);
  const allSame = recent.every((h) => h === recent[0]);
  if (allSame) {
    return `Reasoning content repeated ${recent.length} consecutive times (model may be stuck in thought loop)`;
  }

  return null;
}

// ─── Main class ─────────────────────────────────────────────────────

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
  /** Timeout in ms for the entire run (default: 10 minutes) */
  timeoutMs?: number;
  /** Max consecutive identical tool calls before abort (default: 3) */
  maxConsecutiveIdentical?: number;
  /** Max pattern buffer size for cycle detection (default: 20) */
  maxPatternBuffer?: number;
  /** Max history entries per tool for semantic detection (default: 20) */
  maxHistoryPerTool?: number;
  /** Burn rate window size in steps (default: 5) */
  burnRateWindow?: number;
  /** Burn rate anomaly threshold multiplier (default: 3.0) */
  burnRateThreshold?: number;
  /** Frequency analysis window in ms (default: 60000) */
  frequencyWindowMs?: number;
  /** Max tool calls per tool per frequency window (default: 15) */
  maxCallsPerWindow?: number;
  /** Max consecutive similar reasoning hashes before flag (default: 4) */
  maxConsecutiveSimilarReasoning?: number;
  /** Step-level timeout in ms (default: 120000) */
  stepTimeoutMs?: number;
}

/**
 * Holds the conversation for one chat session and runs turns through the
 * Vercel AI SDK. The SDK drives the tool-calling loop (stopWhen); this class
 * assembles input, streams output, tracks usage, and keeps history.
 *
 * For prompt-cache friendliness the system message is kept out of `messages`
 * and re-supplied as a stable prefix on every turn.
 *
 * Loop detection uses 6 strategies:
 * 1. Consecutive identical calls (A→A→A)
 * 2. Cyclic pattern detection (A→B→A→B)
 * 3. Semantic similarity (same args + same result across steps)
 * 4. Token burn rate anomaly (runaway consumption)
 * 5. Tool call frequency (too many calls in time window)
 * 6. Reasoning content repetition (stuck in thought loop)
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
      userContent = [
        { type: "text", text: opts.userText },
        ...opts.images.map((img) => ({
          type: "image" as const,
          image: img.imageUrl,
          mimeType: img.mimeType,
        })),
      ];
    } else {
      userContent = opts.userText;
    }
    
    this.messages.push({ role: "user", content: userContent });

    // Initialize advanced loop detection state
    const loopState = createAdvancedLoopState({
      maxConsecutiveIdentical: opts.maxConsecutiveIdentical,
      maxPatternBuffer: opts.maxPatternBuffer,
      maxHistoryPerTool: opts.maxHistoryPerTool,
      burnRateWindow: opts.burnRateWindow,
      burnRateThreshold: opts.burnRateThreshold,
      frequencyWindowMs: opts.frequencyWindowMs,
      maxCallsPerWindow: opts.maxCallsPerWindow,
      maxConsecutiveSimilarReasoning: opts.maxConsecutiveSimilarReasoning,
    });

    // Create abort controller with timeout
    const timeoutMs = opts.timeoutMs ?? 600_000; // 10 minutes default
    const runController = new AbortController();
    const timeoutId = setTimeout(() => {
      loopState.lastAbortReason = `Global timeout reached (${timeoutMs}ms)`;
      runController.abort();
    }, timeoutMs);

    // Chain the external abort signal
    const onExternalAbort = () => runController.abort();
    opts.signal.addEventListener("abort", onExternalAbort, { once: true });

    // Accumulate reasoning content for the current step
    let currentStepReasoning = "";
    let lastStepFinishTime = Date.now();
    const stepTimeoutMs = opts.stepTimeoutMs ?? 120_000; // 2 min per step

    try {
      const result = streamText({
        model: opts.model,
        messages: [opts.systemMessage, ...this.messages],
        tools: opts.tools,
        stopWhen: stepCountIs(opts.maxSteps),
        abortSignal: runController.signal,
        maxOutputTokens: opts.maxOutputTokens,
        providerOptions: opts.providerOptions as StreamTextProviderOptions,
        onStepFinish: (step) => {
          loopState.stepCount++;
          const toolNames = (step.toolCalls ?? []).map((t) => t.toolName);
          opts.callbacks.onStepUsage(toolNames, toUsage(step.usage));

          // Step-level timeout check
          const now = Date.now();
          const stepDuration = now - lastStepFinishTime;
          if (stepDuration > stepTimeoutMs) {
            loopState.lastAbortReason = `Step ${loopState.stepCount} took ${stepDuration}ms (limit: ${stepTimeoutMs}ms)`;
            runController.abort();
          }
          lastStepFinishTime = now;

          // Reset reasoning accumulator for next step
          currentStepReasoning = "";
        },
      });

      for await (const part of result.fullStream) {
        // Check if loop was detected and abort
        if (runController.signal.aborted) {
          break;
        }

        switch (part.type) {
          case "text-delta":
            opts.callbacks.onTextDelta(part.text);
            break;
          case "reasoning-delta":
            opts.callbacks.onReasoningDelta(part.text);
            currentStepReasoning += part.text;

            // Check reasoning loop on each delta (throttled: every 200 chars)
            if (currentStepReasoning.length % 200 === 0) {
              const reasonLoop = detectReasoningLoop(loopState, currentStepReasoning);
              if (reasonLoop) {
                loopState.lastAbortReason = reasonLoop;
                opts.callbacks.onError(reasonLoop);
                runController.abort();
              }
            }
            break;
          case "tool-call": {
            opts.callbacks.onToolCall(part.toolCallId, part.toolName, part.input);

            // Build call signature
            const argsStr = normalizeArgs(part.input);
            const argsHash = hashString(argsStr);
            const callSignature = `${part.toolName}:${argsHash}`;

            // === Strategy 1: Consecutive identical ===
            const consecResult = detectConsecutiveIdentical(loopState, callSignature);
            if (consecResult) {
              loopState.lastAbortReason = consecResult;
              opts.callbacks.onError(`Loop detected: ${consecResult}. Aborting.`);
              runController.abort();
              break;
            }

            // === Strategy 2: Cyclic pattern ===
            loopState.patternBuffer.push(callSignature);
            if (loopState.patternBuffer.length > loopState.maxPatternBuffer) {
              loopState.patternBuffer.shift();
            }
            const cycleResult = detectCyclicPattern(loopState);
            if (cycleResult) {
              loopState.lastAbortReason = cycleResult;
              opts.callbacks.onError(`Loop detected: ${cycleResult}. Aborting.`);
              runController.abort();
              break;
            }

            // === Strategy 5: Tool frequency ===
            const freqResult = detectToolFrequencyAnomaly(loopState, part.toolName, Date.now());
            if (freqResult) {
              loopState.lastAbortReason = freqResult;
              opts.callbacks.onError(`Loop detected: ${freqResult}. Aborting.`);
              runController.abort();
              break;
            }
            break;
          }
          case "tool-result": {
            opts.callbacks.onToolResult(part.toolCallId, part.toolName, part.output);

            // === Strategy 3: Semantic similarity ===
            // Find the matching tool-call to get argsHash
            // We use the last tool-call signature that matches this toolName
            const resultHash = hashString(normalizeArgs(part.output));
            const lastSignature = loopState.patternBuffer[loopState.patternBuffer.length - 1];
            if (lastSignature) {
              const [tName, aHash] = lastSignature.split(":");
              if (tName === part.toolName) {
                const semResult = detectSemanticSimilarity(
                  loopState,
                  part.toolName,
                  parseInt(aHash, 10),
                  resultHash
                );
                if (semResult) {
                  loopState.lastAbortReason = semResult;
                  opts.callbacks.onError(`Loop detected: ${semResult}. Aborting.`);
                  runController.abort();
                  break;
                }

                // Store in history
                if (!loopState.callHistory.has(part.toolName)) {
                  loopState.callHistory.set(part.toolName, []);
                }
                const hist = loopState.callHistory.get(part.toolName)!;
                hist.push({ argsHash: parseInt(aHash, 10), resultHash, ts: Date.now() });
                if (hist.length > loopState.maxHistoryPerTool) {
                  hist.shift();
                }
              }
            }
            break;
          }
          case "error":
            opts.callbacks.onError(stringifyError(part.error));
            break;
          default:
            break;
        }
      }

      // Final reasoning loop check
      if (currentStepReasoning.length > 0) {
        const reasonLoop = detectReasoningLoop(loopState, currentStepReasoning);
        if (reasonLoop) {
          loopState.lastAbortReason = reasonLoop;
          opts.callbacks.onError(reasonLoop);
        }
      }

      const response = await result.response;
      this.messages.push(...response.messages);
      opts.callbacks.onFinalUsage(toUsage(await result.totalUsage));
      opts.callbacks.onDone();
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e?.name === "AbortError") {
        if (loopState.lastAbortReason) {
          opts.callbacks.onError(`Aborted: ${loopState.lastAbortReason}`);
        } else if (runController.signal.aborted && !opts.signal.aborted) {
          opts.callbacks.onError("Request timed out or loop detected. Please try again.");
        } else {
          opts.callbacks.onError("Request cancelled.");
        }
      } else {
        opts.callbacks.onError(e?.message ?? String(err));
      }
    } finally {
      clearTimeout(timeoutId);
      opts.signal.removeEventListener("abort", onExternalAbort);
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
