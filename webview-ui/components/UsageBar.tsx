import { Badge, Divider, Group, HoverCard, Progress, Stack, Text } from "@mantine/core";
import React from "react";
import { StepUsage, UsageStats } from "../../src/shared/protocol";

interface UsageBarProps {
  usage?: { turn: UsageStats; session: UsageStats; steps: StepUsage[] };
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function UsageBar({ usage }: UsageBarProps) {
  if (!usage) {
    return null;
  }
  const { turn, session, steps } = usage;
  const miss = Math.max(0, turn.inputTokens - turn.cachedInputTokens);
  const hitRate = turn.inputTokens > 0 ? (turn.cachedInputTokens / turn.inputTokens) * 100 : 0;

  return (
    <HoverCard width={300} shadow="md" position="top" withArrow openDelay={120}>
      <HoverCard.Target>
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
          <Text size="xs" c="dimmed" style={{ marginLeft: "auto" }}>
            Σ {fmt(session.totalTokens)}
          </Text>
        </Group>
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

          <Divider my={4} />
          <Text size="xs" fw={700}>Per step (tokens by task)</Text>
          {steps.length === 0 && <Text size="xs" c="dimmed">No steps yet.</Text>}
          {steps.map((s, i) => (
            <Group key={i} justify="space-between" gap={6} wrap="nowrap">
              <Text size="xs" truncate style={{ flex: 1 }}>
                {i + 1}. {s.tools.length ? s.tools.join(", ") : "respond"}
              </Text>
              <Text size="xs" c="dimmed">
                {fmt(s.usage.inputTokens)}/{fmt(s.usage.outputTokens)}
              </Text>
            </Group>
          ))}

          <Divider my={4} />
          <Text size="xs" fw={700}>Session total</Text>
          <Text size="xs" c="dimmed">
            in {fmt(session.inputTokens)} · out {fmt(session.outputTokens)} · cached{" "}
            {fmt(session.cachedInputTokens)} · total {fmt(session.totalTokens)}
          </Text>
        </Stack>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}
