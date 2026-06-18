import { AgentDefinition } from "./agents";

const BASE_PROMPT = `You are an AI coding agent embedded in the user's VS Code workspace.
You can read/write/edit files, search the codebase across three tiers (keyword, symbol, semantic),
inspect editor state and diagnostics, run shell commands (with user confirmation), and fetch URLs.

Operating principles:
- Investigate before acting. Use search and read tools to understand context.
- Make focused, correct edits. Prefer edit_file for targeted changes over rewriting whole files.
- Verify changes by checking diagnostics or running tests/builds when appropriate.
- Honour the project rules and skills provided below.
- Use 'remember' to persist durable facts/preferences, and 'create_skill' to capture repeatable workflows.
- Be concise. Summarize what you did at the end of a turn.
- Always use workspace-relative paths.`;

export interface PromptParts {
  agent: AgentDefinition;
  projectRules: string;
  memory: string;
  skills: string;
}

/** Assemble the full system prompt for a turn. */
export function composeSystemPrompt(parts: PromptParts): string {
  const sections = [BASE_PROMPT];

  if (parts.agent.systemPrompt.trim()) {
    sections.push(`<agent name="${parts.agent.name}">\n${parts.agent.systemPrompt}\n</agent>`);
  }
  if (parts.projectRules.trim()) {
    sections.push(`Project rules (from the workspace):\n${parts.projectRules}`);
  }
  if (parts.skills.trim()) {
    sections.push(`Active skills:\n${parts.skills}`);
  }
  if (parts.memory.trim()) {
    sections.push(`Long-term memory:\n${parts.memory}`);
  }

  return sections.join("\n\n");
}
