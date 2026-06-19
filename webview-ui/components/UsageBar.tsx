import { Badge, Divider, Group, HoverCard, Progress, Stack, Text } from "@mantine/core";
import React from "react";
import { StepUsage, UsageStats } from "../../src/shared/protocol";

interface UsageBarProps {
  usage?: { turn: UsageStats; session: UsageStats; steps: StepUsage[] };
  provider?: string;
  model?: string;
}

/** Approximate cost rates per 1M tokens (USD) by provider/model. */
const COST_RATES: Record<string, { input: number; output: number }> = {
  openai: { input: 2.5, output: 10 },
  anthropic: { input: 3, output: 15 },
  google: { input: 0.075, output: 0.3 },
  vertex: { input: 0.075, output: 0.3 },
  azure: { input: 2.5, output: 10 },
  bedrock: { input: 3, output: 15 },
  mistral: { input: 2, output: 6 },
  groq: { input: 0.59, output: 0.79 },
  deepseek: { input: 0.14, output: 0.28 },
  xai: { input: 3, output: 15 },
};

/** Known context window sizes (tokens) by model name pattern. */
const CONTEXT_LIMITS: Record<string, number> = {
  "gpt-4o": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4.1": 1_000_000,
  "o3": 200_000,
  "o4": 200_000,
  "claude-3-5-sonnet": 200_000,
  "claude-3-5-haiku": 200_000,
  "claude-3-opus": 200_000,
  "claude-4": 200_000,
  "gemini-2.0": 1_000_000,
  "gemini-1.5-pro": 2_000_000,
  "gemini-1.5-flash": 1_000_000,
  "deepseek-chat": 64_000,
  "deepseek-reasoner": 64_000,
  "mistral-large": 128_000,
  "llama-3.3-70b": 128_000,
  "grok-2": 128_000,
};

function getContextLimit(model?: string): number | null {
  if (!model) return null;
  const lower = model.toLowerCase();
  // Try exact match first, then prefix match
  for (const [pattern, limit] of Object.entries(CONTEXT_LIMITS)) {
    if (lower.includes(pattern.toLowerCase())) return limit;
  }
  // Default fallback for well-known providers
  if (lower.startsWith("gpt-")) return 128_000;
  if (lower.startsWith("claude-")) return 200_000;
  if (lower.startsWith("gemini-")) return 1_000_000;
  return null;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(cents: number): string {
  if (cents < 0.01) return "<$0.01";
  if (cents < 1) return `$${cents.toFixed(2)}`;
  return `$${(cents / 100).toFixed(2)}`;
}

function estimateCost(usage: UsageStats, provider?: string): number {
  const rates = COST_RATES[provider ?? ""] ?? { input: 2.5, output: 10 };
  const inputCost = (usage.inputTokens / 1_000_000) * rates.input;
  const outputCost = (usage.outputTokens / 1_000_000) * rates.output;
  return (inputCost + outputCost) * 100; // return in cents
}

export function UsageBar({ usage, provider, model }: UsageBarProps) {
  if (!usage) {
    return null;
  }
  const { turn, session, steps } = usage;
  const miss = Math.max(0, turn.inputTokens - turn.cachedInputTokens);
  const hitRate = turn.inputTokens > 0 ? (turn.cachedInputTokens / turn.inputTokens) * 100 : 0;
  const turnCost = estimateCost(turn, provider);
  const sessionCost = estimateCost(session, provider);

  const contextLimit = getContextLimit(model);
  const usagePct = contextLimit ? (session.totalTokens / contextLimit) * 100 : null;
  const warningLevel: "none" | "warn" | "critical" | "danger" =
    usagePct === null ? "none" :
    usagePct >= 95 ? "danger" :
    usagePct >= 90 ? "critical" :
    usagePct >= 70 ? "warn" : "none";

  return (
    <HoverCard width={320} shadow="md" position="top" withArrow openDelay={120}>
      <HoverCard.Target>
        <div>
          {warningLevel !== "none" && (
            <Group
              gap={6}
              px="sm"
              py={3}
              style={{
                background: warningLevel === "danger"
                  ? "var(--vscode-errorForeground, #f44)"
                  : warningLevel === "critical"
                  ? "var(--vscode-warningForeground, #fc0)"
                  : "var(--vscode-charts-yellow, #e0a000)",
                color: warningLevel === "danger" ? "#fff" : "#000",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              <span>
                {warningLevel === "danger"
                  ? `Context nearly full (${usagePct!.toFixed(0)}% of ${fmt(contextLimit!)}). Start a new chat to avoid truncation.`
                  : warningLevel === "critical"
                  ? `Context at ${usagePct!.toFixed(0)}% — approaching limit.`
                  : `Context at ${usagePct!.toFixed(0)}% — long sessions may hit the limit.`}
              </span>
            </Group>
          )}
          <Group
            gap={8}
            px="sm"
            py={4}
            wrap="nowrap"
            style={{
              borderTop: "1px solid var(--mantine-color-default-border)",
              cursor: "default",
              fontSize: 11,
            }}
          >
            <Badge size="xs" variant="light" color="blue">↑ {fmt(turn.inputTokens)}</Badge>
            <Badge size="xs" variant="light" color="teal">↓ {fmt(turn.outputTokens)}</Badge>
            {turn.reasoningTokens > 0 && (
              <Badge size="xs" variant="light" color="grape">🧠 {fmt(turn.reasoningTokens)}</Badge>
            )}
            <Badge size="xs" variant="light" color="green">
              cache {hitRate.toFixed(0)}%
            </Badge>
            <Badge size="xs" variant="light" color="yellow">
              ~{fmtCost(turnCost)}
            </Badge>
            <Text size="xs" c="dimmed" style={{ marginLeft: "auto" }}>
              Σ {fmt(session.totalTokens)} · ~{fmtCost(sessionCost)}
            </Text>
          </Group>
        </div>
      </HoverCard.Target>
      <HoverCard.Dropdown>
        <Stack gap={6}>
          <Text size="xs" fw={700}>This turn</Text>
          <Group gap={10}>
            <Text size="xs">Input {fmt(turn.inputTokens)}</Text>
            <Text size="xs">Output {fmt(turn.outputTokens)}</Text>
            <Text size="xs">Reasoning {fmt(turn.reasoningTokens)}</Text>
          </Group>
          <Text size="xs" c="dimmed">
            Cache hit {fmt(turn.cachedInputTokens)} · miss {fmt(miss)}
          </Text>
          <Progress.Root size="sm">
            <Progress.Section value={hitRate} color="green" />
            <Progress.Section value={100 - hitRate} color="gray" />
          </Progress.Root>
          <Text size="xs" c="dimmed">
            Estimated cost: ~{fmtCost(turnCost)}
          </Text>

          {contextLimit && (
            <>
              <Divider my={4} />
              <Text size="xs" fw={700}>Context window</Text>
              <Group gap={10}>
                <Text size="xs">{fmt(session.totalTokens)} / {fmt(contextLimit)} tokens</Text>
                <Text size="xs" c="dimmed">{usagePct?.toFixed(1)}%</Text>
              </Group>
              <Progress.Root size="sm">
                <Progress.Section
                  value={Math.min(usagePct ?? 0, 100)}
                  color={warningLevel === "danger" ? "red" : warningLevel === "critical" ? "yellow" : "blue"}
                />
              </Progress.Root>
            </>
          )}

          <Divider my={4} />
          <Text size="xs" fw={700}>Per step (tokens by task)</Text>
          {steps.length === 0 && <Text size="xs" c="dimmed">No steps yet.</Text>}
          {steps.map((s, i) => {
            const stepCost = estimateCost(s.usage, provider);
            return (
              <Group key={i} justify="space-between" gap={6} wrap="nowrap">
                <Text size="xs" truncate style={{ flex: 1 }}>
                  {i + 1}. {s.tools.length ? s.tools.join(", ") : "respond"}
                </Text>
                <Text size="xs" c="dimmed">
                  {fmt(s.usage.inputTokens)}/{fmt(s.usage.outputTokens)} · ~{fmtCost(stepCost)}
                </Text>
              </Group>
            );
          })}

          <Divider my={4} />
          <Text size="xs" fw={700}>Session total</Text>
          <Text size="xs" c="dimmed">
            in {fmt(session.inputTokens)} · out {fmt(session.outputTokens)} · cached{" "}
            {fmt(session.cachedInputTokens)} · total {fmt(session.totalTokens)}
          </Text>
          <Text size="xs" c="dimmed">
            Estimated session cost: ~{fmtCost(sessionCost)}
          </Text>
        </Stack>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}
