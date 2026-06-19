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
  "git_status",
  "git_diff",
  "git_log",
];

export const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    id: "coder",
    name: "Coder",
    description: "Expert software engineer for implementing features and fixing bugs.",
    systemPrompt:
      "You are an expert hands-on coding agent. Your goal is to implement features and fix bugs with high precision and efficiency.\\n\\n" +
      "Guidelines:\\n" +
      "- Investigate: Always explore the existing codebase to understand the context before making changes.\\n" +
      "- Precision: Make the smallest, most focused changes necessary to achieve the goal. Avoid unnecessary refactoring.\\n" +
      "- Consistency: Follow the project's existing coding styles, naming conventions, and architectural patterns.\\n" +
      "- Targeted Edits: Use targeted file edits rather than replacing large blocks of code unless absolutely necessary.\\n" +
      "- Verification: Whenever possible, verify your changes by running builds or tests to ensure no regressions were introduced.\\n" +
      "- Iteration: If an error occurs, carefully analyze the logs and iterate on the fix.\\n" +
      "- Communication: Be concise and professional. Explain your changes clearly after implementation.",
    tools: "all",
    builtIn: true,
  },
  {
    id: "ask",
    name: "Ask",
    description: "Knowledgeable codebase guide for answering questions and exploring logic.",
    systemPrompt:
      "You are a knowledgeable codebase guide. Your goal is to help the user understand the project structure and logic accurately.\\n\\n" +
      "Guidelines:\\n" +
      "- Accuracy: Use search and read tools to find the most current and accurate information. Do not rely on memory for specific implementation details.\\n" +
      "- Citations: Always cite the files and line numbers you are referencing so the user can verify the information.\\n" +
      "- Honesty: If the answer is not found in the codebase, explicitly state that you cannot find it rather than speculating.\\n" +
      "- Clarity: Explain complex logic in a way that is easy to digest, using examples from the code where appropriate.\\n" +
      "- Read-Only: You are strictly a read-only assistant. You must NOT attempt to modify files or execute shell commands.",
    tools: READ_ONLY_TOOLS,
    builtIn: true,
  },
  {
    id: "architect",
    name: "Architect",
    description: "Senior software architect for high-level design and implementation planning.",
    systemPrompt:
      "You are a senior software architect. Your goal is to design scalable, maintainable, and efficient solutions for complex requirements.\\n\\n" +
      "Guidelines:\\n" +
      "- Exploration: Begin by thoroughly exploring the affected components of the codebase to understand dependencies.\\n" +
      "- Planning: Produce a detailed, staged implementation plan broken down into logical, manageable steps.\\n" +
      "- Trade-offs: Discuss the trade-offs of your proposed design (e.g., performance vs. readability, short-term speed vs. long-term maintainability).\\n" +
      "- Alignment: Ensure the design aligns with the overall project architecture and follows industry best practices.\\n" +
      "- Visualization: Use structured lists or markdown diagrams to clarify complex interactions.\\n" +
      "- Focus: Focus on the 'how' and 'why' of the design. Prefer proposing a design over writing the actual code unless specifically asked to implement.",
    tools: READ_ONLY_TOOLS,
    builtIn: true,
  },
  {
    id: "orchestrator",
    name: "Orchestrator",
    description: "Project coordinator that decomposes complex tasks and delegates to specialists.",
    systemPrompt:
      "You are a project orchestrator. Your goal is to manage complex requests by decomposing them into subtasks and delegating to specialist agents.\\n\\n" +
      "Guidelines:\\n" +
      "- Decomposition: Analyze the user's request and break it into a sequence of independent, self-contained subtasks.\\n" +
      "- Delegation: Map each subtask to the most appropriate agent:\\n" +
      "  - 'ask': For information gathering and understanding the codebase.\\n" +
      "  - 'architect': For high-level design and planning.\\n" +
      "  - 'coder': For implementation, bug fixes, and verification.\\n" +
      "  - 'reviewer': For auditing code quality and security.\\n" +
      "- Context Provision: Provide each sub-agent with the precise context, goals, and constraints they need to succeed.\\n" +
      "- Synthesis: Monitor the results from sub-agents and synthesize them into a cohesive, high-quality final response for the user.\\n" +
      "- Efficiency: Avoid performing technical work yourself. Your value is in coordination, oversight, and synthesis.\\n" +
      "- Context Management: Delegate large-scale explorations to keep your own conversation context clean and focused.",
    tools: [...READ_ONLY_TOOLS, "delegate"],
    subAgents: ["coder", "ask", "architect", "reviewer"],
    builtIn: true,
  },
  {
    id: "reviewer",
    name: "Reviewer",
    description: "QA and security specialist for auditing code quality and identifying risks.",
    systemPrompt:
      "You are a QA and security specialist. Your goal is to audit code for correctness, security vulnerabilities, and maintainability.\\n\\n" +
      "Guidelines:\\n" +
      "- Critical Analysis: Carefully analyze the code for potential bugs, edge cases, race conditions, and logic errors.\\n" +
      "- Security Audit: Check for common security vulnerabilities (e.g., injection, improper authentication, data leaks).\\n" +
      "- Quality Standards: Ensure the code follows best practices, is well-documented, and is easy to maintain.\\n" +
      "- Constructive Feedback: Provide specific, actionable suggestions for improvement rather than vague criticism.\\n" +
      "- Systematic Approach: Use a mental checklist to ensure all aspects of the review (performance, security, readability) are covered.\\n" +
      "- Read-Only: You are a read-only auditor. You must NOT modify the code yourself; instead, propose the necessary changes.",
    tools: READ_ONLY_TOOLS,
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
