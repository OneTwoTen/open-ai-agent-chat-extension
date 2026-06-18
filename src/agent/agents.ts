import * as path from "path";
import * as vscode from "vscode";
import { ProviderId } from "../providers/catalog";
import { resolveAgentchatDir } from "./dataPath";

/** A configurable agent persona with its own prompt, tools, and model. */
export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  /** Extra system instructions appended to the base prompt. */
  systemPrompt: string;
  /** Allowed tool names, or "all". */
  tools: string[] | "all";
  /** Optional provider/model override for this agent. */
  provider?: ProviderId;
  model?: string;
  /** Skill names this agent always loads. */
  skills?: string[];
  /** Ids of agents this agent may delegate to as sub-agents. */
  subAgents?: string[];
  /** True for the shipped defaults (not user-editable on disk). */
  builtIn?: boolean;
}

/** Read-only tool set (no mutations, no command execution). */
const READ_ONLY_TOOLS = [
  "read_file",
  "list_directory",
  "find_files",
  "search_text",
  "search_symbols",
  "search_semantic",
  "get_open_editors",
  "get_active_selection",
  "get_diagnostics",
  "fetch_url",
];

export const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    id: "coder",
    name: "Coder",
    description: "Full-access coding agent that can edit files and run commands.",
    systemPrompt:
      "You are a hands-on coding agent. Investigate, then make focused, correct edits. " +
      "Run builds/tests to verify your work when appropriate.",
    tools: "all",
    builtIn: true,
  },
  {
    id: "ask",
    name: "Ask",
    description: "Read-only assistant for questions about the codebase. Cannot modify files.",
    systemPrompt:
      "You are a read-only assistant. Answer questions about the codebase using search and read tools. " +
      "You must not modify files or run commands.",
    tools: READ_ONLY_TOOLS,
    builtIn: true,
  },
  {
    id: "architect",
    name: "Architect",
    description: "Planning agent that proposes designs before implementation.",
    systemPrompt:
      "You are a software architect. Explore the codebase, then produce a clear, staged implementation plan. " +
      "Prefer proposing designs over writing code unless asked to implement.",
    tools: READ_ONLY_TOOLS,
    builtIn: true,
  },
  {
    id: "orchestrator",
    name: "Orchestrator",
    description:
      "Coordinator that delegates self-contained subtasks to specialist sub-agents to keep context small.",
    systemPrompt:
      "You are an orchestrator. Break the request into self-contained subtasks and delegate each to the most " +
      "suitable sub-agent using the 'delegate' tool, passing all context the sub-agent needs. " +
      "Do the minimum yourself; synthesize the sub-agents' results into a final answer. " +
      "Prefer delegating large explorations so their intermediate steps stay out of your context.",
    tools: [...READ_ONLY_TOOLS, "delegate"],
    subAgents: ["coder", "ask", "architect"],
    builtIn: true,
  },
];

/** Loads built-in agents plus user-defined agents from .agentchat/agents. */
export class AgentManager {
  private readonly dir: vscode.Uri;

  constructor(workspaceRoot: string) {
    this.dir = vscode.Uri.file(path.join(resolveAgentchatDir(workspaceRoot), "agents"));
  }

  async list(): Promise<AgentDefinition[]> {
    return [...BUILTIN_AGENTS, ...(await this.loadUserAgents())];
  }

  async get(id: string): Promise<AgentDefinition | undefined> {
    return (await this.list()).find((a) => a.id === id);
  }

  private async loadUserAgents(): Promise<AgentDefinition[]> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(this.dir);
    } catch {
      return [];
    }
    const agents: AgentDefinition[] = [];
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith(".json")) {
        continue;
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(
          vscode.Uri.joinPath(this.dir, name)
        );
        const raw = JSON.parse(Buffer.from(bytes).toString("utf8"));
        const id = String(raw.id || path.basename(name, ".json"));
        agents.push({
          id,
          name: String(raw.name || id),
          description: String(raw.description || ""),
          systemPrompt: String(raw.systemPrompt || ""),
          tools: Array.isArray(raw.tools) ? raw.tools.map(String) : "all",
          provider: raw.provider,
          model: raw.model,
          skills: Array.isArray(raw.skills) ? raw.skills.map(String) : undefined,
          subAgents: Array.isArray(raw.subAgents) ? raw.subAgents.map(String) : undefined,
        });
      } catch {
        // skip malformed agent file
      }
    }
    return agents;
  }

  /** Persist a new/updated user agent definition. */
  async save(agent: AgentDefinition): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.dir);
    const file = vscode.Uri.joinPath(this.dir, `${agent.id}.json`);
    const { builtIn, ...persisted } = agent;
    await vscode.workspace.fs.writeFile(
      file,
      Buffer.from(JSON.stringify(persisted, null, 2), "utf8")
    );
  }

  /** Delete a user-defined agent (built-ins cannot be deleted). */
  async delete(id: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(this.dir, `${id}.json`));
    } catch {
      // not present
    }
  }
}
