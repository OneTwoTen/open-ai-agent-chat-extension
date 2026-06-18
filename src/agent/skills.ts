import * as path from "path";
import * as vscode from "vscode";
import { resolveAgentchatDir } from "./dataPath";

/** Read a workspace text file, returning null if missing/unreadable. */
async function readText(uri: vscode.Uri): Promise<string | null> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return null;
  }
}

async function listFiles(dir: vscode.Uri): Promise<vscode.Uri[]> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(dir);
    return entries
      .filter(([, type]) => type === vscode.FileType.File)
      .map(([name]) => vscode.Uri.joinPath(dir, name));
  } catch {
    return [];
  }
}

/**
 * Known instruction/rules files from popular AI IDEs & CLIs. Loading these
 * makes the agent honour the same project conventions a user already wrote
 * for Cursor, Claude Code, Copilot, Windsurf, Cline, Kiro, etc.
 */
const RULE_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "CLAUDE.local.md",
  ".cursorrules",
  ".windsurfrules",
  ".clinerules",
  ".rules",
  ".github/copilot-instructions.md",
];

const RULE_DIRS = [".cursor/rules", ".clinerules", ".kiro/steering", ".agentchat/rules"];

const MAX_RULES_CHARS = 12_000;

/** Load and concatenate all compatible project rule files. */
export async function loadProjectRules(workspaceRoot: string): Promise<string> {
  const root = vscode.Uri.file(workspaceRoot);
  const sections: string[] = [];

  for (const rel of RULE_FILES) {
    const content = await readText(vscode.Uri.joinPath(root, rel));
    if (content && content.trim()) {
      sections.push(`<rules source="${rel}">\n${content.trim()}\n</rules>`);
    }
  }

  for (const dir of RULE_DIRS) {
    const files = await listFiles(vscode.Uri.joinPath(root, dir));
    for (const file of files) {
      if (!/\.(md|mdc|txt)$/i.test(file.fsPath)) {
        continue;
      }
      const content = await readText(file);
      if (content && content.trim()) {
        const rel = path.relative(workspaceRoot, file.fsPath).replace(/\\/g, "/");
        sections.push(`<rules source="${rel}">\n${content.trim()}\n</rules>`);
      }
    }
  }

  // Also check for rules in configured agentchat directory
  const configuredRulesDir = path.join(resolveAgentchatDir(workspaceRoot), "rules");
  if (configuredRulesDir !== path.join(workspaceRoot, ".agentchat", "rules")) {
    const files = await listFiles(vscode.Uri.file(configuredRulesDir));
    for (const file of files) {
      if (!/\.(md|mdc|txt)$/i.test(file.fsPath)) {
        continue;
      }
      const content = await readText(file);
      if (content && content.trim()) {
        const rel = path.relative(workspaceRoot, file.fsPath).replace(/\\/g, "/");
        sections.push(`<rules source="${rel}">\n${content.trim()}\n</rules>`);
      }
    }
  }

  const joined = sections.join("\n\n");
  return joined.length > MAX_RULES_CHARS
    ? joined.slice(0, MAX_RULES_CHARS) + "\n[...rules truncated]"
    : joined;
}

/** A reusable instruction module the user or agent can author. */
export interface Skill {
  name: string;
  description: string;
  /** When true, the skill is always injected into the system prompt. */
  alwaysApply: boolean;
  body: string;
}

/** Parse very small YAML-style frontmatter (key: value pairs). */
function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) {
    return { meta: {}, body: text };
  }
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = /^([\w-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) {
      meta[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  return { meta, body: match[2] };
}

/**
 * Manages reusable skills stored as markdown files in .agentchat/skills.
 * Skills let the agent (and user) capture repeatable instructions, and are
 * the unit the agent edits when it "improves itself".
 */
export class SkillManager {
  private readonly dir: vscode.Uri;

  constructor(workspaceRoot: string) {
    this.dir = vscode.Uri.file(path.join(resolveAgentchatDir(workspaceRoot), "skills"));
  }

  async list(): Promise<Skill[]> {
    const files = await listFiles(this.dir);
    const skills: Skill[] = [];
    for (const file of files) {
      if (!file.fsPath.endsWith(".md")) {
        continue;
      }
      const text = await readText(file);
      if (!text) {
        continue;
      }
      const { meta, body } = parseFrontmatter(text);
      const name = meta.name || path.basename(file.fsPath, ".md");
      skills.push({
        name,
        description: meta.description || "",
        alwaysApply: meta.alwaysapply === "true" || meta.always === "true",
        body: body.trim(),
      });
    }
    return skills;
  }

  async get(name: string): Promise<Skill | undefined> {
    return (await this.list()).find((s) => s.name === name);
  }

  /** Create or overwrite a skill file. */
  async save(skill: {
    name: string;
    description?: string;
    alwaysApply?: boolean;
    body: string;
  }): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.dir);
    const frontmatter = [
      "---",
      `name: ${skill.name}`,
      `description: ${skill.description ?? ""}`,
      `alwaysApply: ${skill.alwaysApply ? "true" : "false"}`,
      "---",
      "",
    ].join("\n");
    const file = vscode.Uri.joinPath(this.dir, `${slug(skill.name)}.md`);
    await vscode.workspace.fs.writeFile(
      file,
      Buffer.from(frontmatter + skill.body.trim() + "\n", "utf8")
    );
  }

  /** Build the always-on portion of the skills for the system prompt. */
  async alwaysApplyText(): Promise<string> {
    const skills = (await this.list()).filter((s) => s.alwaysApply);
    if (skills.length === 0) {
      return "";
    }
    return skills
      .map((s) => `<skill name="${s.name}">\n${s.body}\n</skill>`)
      .join("\n\n");
  }

  /** Delete a skill by name. */
  async delete(name: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(this.dir, `${slug(name)}.md`));
    } catch {
      // not present
    }
  }
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
