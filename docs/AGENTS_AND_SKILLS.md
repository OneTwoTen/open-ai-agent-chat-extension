# Agents, skills, rules & memory

All workspace-level configuration lives under `.agentchat/` so it can be committed and shared with a team.

```
.agentchat/
├── agents/      # user-defined agent personas (*.json)
├── skills/      # reusable instruction modules (*.md)
├── rules/       # extra always-on rules (*.md)  [optional]
└── memory.md    # long-term agent memory
```

## Agents

An agent is a persona with its own system prompt, tool allow-list, and optional model override. Pick one from the **agent dropdown** in the chat header.

### Built-in agents

| Id | Tools | Purpose |
| --- | --- | --- |
| `coder` | all | Hands-on coding: edits files, runs commands. |
| `ask` | read-only | Answers questions; cannot modify files or run commands. |
| `architect` | read-only | Produces staged implementation plans. |
| `orchestrator` | read-only + `delegate` | Splits work and delegates subtasks to sub-agents. |

### Delegation (sub-agents)

An agent that lists `subAgents` gets the `delegate` tool. Calling `delegate(agentId, task)` runs
that sub-agent in an **isolated conversation** and returns only its final text — the sub-agent's
intermediate tool calls stay out of the caller's context, which keeps token usage low. Sub-agents
cannot delegate further (depth 1). The built-in **Orchestrator** demonstrates the pattern; you can
also add `subAgents` to any custom agent.

### User-defined agents

Create one with **AI Agent: Create Agent**, or add `.agentchat/agents/<id>.json`:

```json
{
  "id": "reviewer",
  "name": "Reviewer",
  "description": "Reviews diffs for bugs and style.",
  "systemPrompt": "You are a meticulous code reviewer. Focus on correctness and edge cases.",
  "tools": ["read_file", "search_text", "search_symbols", "get_diagnostics"],
  "provider": "anthropic",
  "model": "claude-3-5-sonnet-20241022",
  "skills": ["our-style-guide"]
}
```

`tools` is either an array of tool names or `"all"`. `provider`/`model` are optional overrides. `skills` are always injected for this agent.

## Skills

A skill is a reusable instruction module stored as markdown with frontmatter. Create one with **AI Agent: Create Skill** or let the agent author one via the `create_skill` tool.

```markdown
---
name: our-style-guide
description: Project coding conventions
alwaysApply: true
---

- Use 2-space indentation.
- Prefer composition over inheritance.
- All public functions need JSDoc.
```

- `alwaysApply: true` injects the skill into every turn.
- Otherwise a skill applies when an agent lists it under `skills`.

## Rules compatibility

On every turn the extension loads instruction files written for other AI tools, so existing project conventions are respected automatically:

- `AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md`
- `.cursorrules`, `.cursor/rules/*.md|*.mdc`
- `.github/copilot-instructions.md`
- `.windsurfrules`, `.clinerules` (+ `.clinerules/*.md`)
- `.rules`, `.kiro/steering/*.md`, `.agentchat/rules/*.md`

These are concatenated (capped in size) and added to the system prompt as `<rules>` sections.

## Memory & self-improvement

- **`remember`** appends a durable fact or preference to `.agentchat/memory.md`. Memory is read back into the system prompt each turn.
- **`create_skill`** lets the agent capture a repeatable workflow as a new skill it (and you) can reuse later.

Together these let the agent refine its own behaviour over time: it can record what it learned about your project and codify recurring procedures as skills, without code changes.

## Precedence

System prompt assembly order (`src/agent/prompt.ts`): base instructions → selected agent prompt → project rules → active skills → long-term memory.
