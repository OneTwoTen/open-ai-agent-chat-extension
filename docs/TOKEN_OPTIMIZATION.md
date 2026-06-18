# Token optimization & prompt caching

How this extension keeps multi-agent token spend low and cache-hit rate high. Each technique notes where it lives in the code.

## 1. Maximize the prompt-cache hit rate

Providers cache a **prefix** of the request. A cache hit only happens when the beginning of the request is byte-for-byte identical to a previous one. The rule: **stable content first, volatile content last.**

### Stable prefix ordering
The system prompt is assembled in a fixed order (`src/agent/prompt.ts`): base instructions → agent prompt → project rules → skills → memory. It is supplied as a leading message that does not change within a session (`AgentSession` keeps it out of the rolling `messages` array and re-prepends the same instance every turn — `src/agent/agent.ts`). Tool definitions are also stable, so the cached prefix covers system + tools + tools-unchanged history.

### Explicit cache breakpoints (Anthropic / Bedrock)
These providers cache only up to an explicit marker. `buildSystemMessage` (`src/agent/providerTuning.ts`) attaches `providerOptions.anthropic.cacheControl = { type: 'ephemeral' }` to the system message, so the large system prompt is written to cache once and reused at ~10% of input price on later turns.

### Automatic caching (OpenAI / Google / DeepSeek)
No markers needed — they cache automatically when the prefix repeats. We benefit simply by keeping the prefix stable. Caching kicks in for prefixes above the provider's minimum (e.g. ~1024 tokens for OpenAI), which is why rules/skills/memory live in the system prompt rather than being injected per message.

### What breaks a cache hit (avoid these)
- Putting timestamps, random ids, or per-turn data near the top of the prompt.
- Reordering tools or rules between turns.
- Editing memory mid-session (it changes the prefix). The agent is told to batch `remember` calls.

### Measuring it
Every turn reports `cachedInputTokens` vs uncached input. The UI footer shows a live **cache %** and the hover card breaks down hit/miss (`webview-ui/components/UsageBar.tsx`). Watch this number: a healthy multi-turn session trends toward 70–90% on cache-capable providers.

## 2. Spend fewer tokens with multiple agents

More agents must not mean more tokens. The design keeps context small per call.

### Scope tools per agent
An agent only receives the tools it needs (`tools` allow-list in the agent config). Fewer tool schemas = smaller, more cacheable prefix. The read-only `Ask`/`Architect` agents ship far fewer tools than `Coder`.

### Sub-agent context isolation (delegation)
Agents can declare `subAgents`, which unlocks the **`delegate` tool**. The agent calls
`delegate(agentId, task)`; the sub-agent runs in a **fresh, isolated conversation** and only its
**final text result** is returned to the caller — its intermediate tool calls never enter the
parent's context. The built-in **Orchestrator** agent is set up to do exactly this. Sub-agents
cannot delegate further (depth 1) to prevent runaway fan-out. Sub-agent token usage is folded
into the session totals so the cost stays visible.

> Why this saves tokens: input cost grows with conversation length on every step of the tool loop. Isolating a 20-step file hunt in a sub-agent keeps those 20 steps out of the parent's prefix forever — the parent only ever sees the short summary.

### Right-size the model and reasoning
- Use a small/cheap model for narrow agents (per-agent `model` override).
- Reasoning effort is a dial (`off/low/medium/high`). It is **gated per model**: the request only
  carries reasoning options when the selected model actually supports them (e.g. OpenAI o-series,
  Claude 3.7/4, Gemini 2.x, DeepSeek reasoner), so picking a non-reasoning model never wastes
  tokens or errors. When reasoning is on, `maxOutputTokens` is auto-sized so the answer isn't
  truncated by the thinking budget. Reasoning tokens are billed as output and shown in the footer.

### Retrieve, don't dump
The three-tier search returns only relevant slices instead of whole files. Tier 3 semantic search returns the top-k chunks, keeping retrieved context compact. Prefer `edit_file` (a small diff) over re-sending whole files.

## 3. Keep the conversation lean

- History is replayed each turn, so long chats cost more. Start a **new chat** for unrelated tasks rather than letting one thread grow unbounded.
- Attachments are truncated (40k chars) before being inlined.
- Tool results are truncated (file reads at 60k, URL fetch at 20k) to avoid context blowups.

## 4. Practical checklist

- Keep system prompt / rules / skills stable within a session → high cache hit.
- Put the user's volatile request and fresh context at the end.
- Give each agent the minimum tool set.
- Delegate big explorations to sub-agents; return summaries.
- Use `off` reasoning unless the task needs it; pick the cheapest capable model.
- Watch the cache % and session total in the footer; start a new chat when a thread gets long.

## Implementation index

| Technique | Code |
| --- | --- |
| Stable system prefix | `src/agent/prompt.ts`, `src/agent/agent.ts` |
| Anthropic cache breakpoint | `src/agent/providerTuning.ts` |
| Reasoning effort dial + per-model gating + auto maxOutputTokens | `src/agent/providerTuning.ts`, `src/agent/agent.ts` |
| Per-agent tool scoping | `src/agent/agents.ts`, `src/agent/tools.ts` |
| Sub-agent delegation (`delegate` tool + runner) | `src/agent/tools.ts`, `src/ChatViewProvider.ts` (`runSubAgent`), Orchestrator in `src/agent/agents.ts` |
| Usage + cache metrics | `src/agent/agent.ts` (`onStepFinish`/`totalUsage`), `webview-ui/components/UsageBar.tsx` |
| Truncation limits | `src/agent/tools.ts`, `src/ChatViewProvider.ts` |
