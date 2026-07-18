/**
 * SkillManager — discovers, loads, and manages agent skills.
 *
 * Skills are directories containing a SKILL.md with YAML frontmatter.
 * The manager scans two locations:
 *   - ~/.babyAgent/skills/          (user-level)
 *   - cwd/.babyAgent/skills/         (project-level)
 *
 * Project-level skills override user-level skills with the same name.
 * Skills with disable-model-invocation:true are loaded but excluded
 * from the system prompt (only available via /skill:<name>).
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

// ============================================================================
// Types
// ============================================================================

/** Parsed skill metadata (body not loaded). */
export interface SkillMeta {
  name: string;
  description: string;
  source: "user" | "project";
  disableModelInvocation: boolean;
}

// ============================================================================
// SkillManager
// ============================================================================

export class SkillManager {
  private skills: SkillMeta[] = [];
  private userSkillsDir: string;
  private projectSkillsDir: string;
  /** In-memory cache of rewritten skill content (with absolute paths), keyed by skill name. */
  private contentCache: Map<string, string> = new Map();
  /** Pre-computed SHA-256 content hashes (from raw SKILL.md, before path rewrite). */
  private contentHashCache: Map<string, string> = new Map();

  /**
   * @param userSkillsDir    User-level skills dir (default ~/.babyAgent/skills)
   * @param projectSkillsDir Project-level skills dir (default cwd/.babyAgent/skills)
   */
  constructor(userSkillsDir?: string, projectSkillsDir?: string) {
    this.userSkillsDir =
      userSkillsDir ?? path.join(os.homedir(), ".babyAgent", "skills");
    this.projectSkillsDir =
      projectSkillsDir ?? path.join(process.cwd(), ".babyAgent", "skills");
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /** Scan and load all skill metadata. Call once at startup. */
  async loadSkills(): Promise<SkillMeta[]> {
    const all: SkillMeta[] = [];

    // Load user-level skills first
    const userSkills = await this._scanDirectory(this.userSkillsDir, "user");
    all.push(...userSkills);

    // Load project-level skills (override user-level by name)
    const projectSkills = await this._scanDirectory(
      this.projectSkillsDir,
      "project",
    );
    for (const ps of projectSkills) {
      const idx = all.findIndex((s) => s.name === ps.name);
      if (idx !== -1) {
        all[idx] = ps; // override
      } else {
        all.push(ps);
      }
    }

    this.skills = all;
    return all;
  }

  /** Return all loaded skills. */
  getSkills(): SkillMeta[] {
    return this.skills;
  }

  /** Find a skill by name. Includes disabled skills. */
  getSkill(name: string): SkillMeta | undefined {
    return this.skills.find((s) => s.name === name);
  }

  /**
   * Resolve the absolute path to a skill's SKILL.md file.
   * @param skill  SkillMeta object (must have source and name).
   */
  private getSkillPath(skill: SkillMeta): string {
    const baseDir =
      skill.source === "user" ? this.userSkillsDir : this.projectSkillsDir;
    return path.join(baseDir, skill.name, "SKILL.md");
  }

  /** Read a skill's full SKILL.md content on demand, with relative paths rewritten
   *  to absolute paths so the Agent can access auxiliary resources in the skill
   *  directory. Results are cached in-memory (rewritten form). */
  async readSkillContent(name: string): Promise<string> {
    // Return cached content if available (already stripped + rewritten).
    const cached = this.contentCache.get(name);
    if (cached !== undefined) return cached;

    const skill = this.getSkill(name);
    if (!skill) {
      throw new Error(`Skill "${name}" not found.`);
    }

    const skillPath = this.getSkillPath(skill);
    const skillDir = path.dirname(skillPath);
    const raw = await fs.readFile(skillPath, "utf-8");

    // Pre-compute content hash from raw SKILL.md (before any transformation)
    // so that the hash is stable across different machines (paths vary).
    const hash = crypto
      .createHash("sha256")
      .update(raw)
      .digest("hex")
      .slice(0, 16);
    this.contentHashCache.set(name, hash);

    // Strip YAML frontmatter so the LLM sees only actionable instructions,
    // not metadata delimiters (---).  Hash is still computed from raw content.
    const bodyOnly = this._stripFrontmatter(raw);

    // Rewrite relative paths to absolute so the Agent can access auxiliary
    // resources (scripts, templates, data files, etc.) via tools.
    const rewritten = this._rewriteRelativePaths(bodyOnly, skillDir);
    this.contentCache.set(name, rewritten);
    return rewritten;
  }

  /**
   * Get a pre-computed content hash for a skill (SHA-256 hex, first 16 chars).
   * Hash is computed from the raw SKILL.md content (before path rewriting),
   * making it stable across different machines.
   * Returns null if the skill content has not been loaded yet.
   */
  getSkillContentHash(name: string): string | null {
    return this.contentHashCache.get(name) ?? null;
  }

  /**
   * Format skills for the Skill meta-tool description.
   * Only includes skills where disableModelInvocation !== true.
   * Returns empty string if no visible skills.
   *
   * @param tokenBudget  Max characters for description budget (default: 15000).
   *                     Descriptions are truncated from least-used skills first.
   */
  formatSkillsForToolDescription(tokenBudget?: number): string {
    const visible = this.skills.filter((s) => !s.disableModelInvocation);
    if (visible.length === 0) return "";

    const budget = tokenBudget ?? 15000;

    const header = [
      "Execute a skill within the main conversation",
      "",
      "<skills_instructions>",
      "当用户要求你执行任务时，检查下面的可用技能是否可以更有效地帮助完成任务。",
      "技能提供专业知识和领域能力。",
      "",
      "如何使用技能：",
      "- 使用此工具调用技能，只需传入技能名称（不带参数）",
      "- 调用技能后，其提示词将展开并提供完成任务的详细说明",
      '- 示例：`command: "fixbug"` 调用 fixbug 技能',
      "",
      "重要：",
      "- 只使用下面 <available_skills> 中列出的技能",
      "- 不要调用已经在运行的技能",
      "</skills_instructions>",
      "",
      "<available_skills>",
    ].join("\n");

    // Build skill entries: "name": description
    const entries = visible.map((s) => `"${s.name}": ${s.description}`);

    // Fit within budget: header first, then as many entries as fit
    let result = header;
    const footer = "</available_skills>";
    let remaining = budget - result.length - footer.length;

    for (const entry of entries) {
      if (remaining - entry.length >= 0) {
        result += "\n" + entry;
        remaining -= entry.length;
      } else {
        // Add truncated count
        const omitted = entries.indexOf(entry);
        const left = visible.length - omitted;
        if (left > 0) {
          result += `\n(+ ${left} more skills omitted due to budget)`;
        }
        break;
      }
    }

    result += "\n" + footer;
    return result;
  }

  // ==========================================================================
  // Private: Directory Scanning
  // ==========================================================================

  private async _scanDirectory(
    dirPath: string,
    source: "user" | "project",
  ): Promise<SkillMeta[]> {
    const skills: SkillMeta[] = [];

    let entries: string[];
    try {
      entries = await fs.readdir(dirPath);
    } catch {
      // Directory doesn't exist — silently skip
      return skills;
    }

    for (const entryName of entries) {
      // Skip hidden dirs and node_modules
      if (entryName.startsWith(".") || entryName === "node_modules") {
        continue;
      }

      const skillDir = path.join(dirPath, entryName);

      // Must be a directory
      try {
        const stat = await fs.stat(skillDir);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      const skillMdPath = path.join(skillDir, "SKILL.md");

      let content: string;
      try {
        content = await fs.readFile(skillMdPath, "utf-8");
      } catch {
        // No SKILL.md in this directory — skip
        continue;
      }

      const parsed = this._parseFrontmatter(content);
      if (!parsed || !parsed.description) {
        // Description is required — skip with warning
        console.warn(`[Skills] Skipping "${entryName}": missing description`);
        continue;
      }

      skills.push({
        name: entryName,
        description: parsed.description,
        source,
        disableModelInvocation: parsed.disableModelInvocation ?? false,
      });
    }

    return skills;
  }

  // ==========================================================================
  // Private: Frontmatter Stripping
  // ==========================================================================

  /**
   * Strip YAML frontmatter (--- delimited block at the start) from
   * raw SKILL.md content.  Returns only the body (instructions).
   * If no frontmatter is found, returns the original content.
   *
   * Frontmatter is metadata for the skill loader; it should not be
   * injected into the LLM context as it confuses the model.
   */
  private _stripFrontmatter(raw: string): string {
    const lines = raw.split("\n");
    const firstLine = lines[0]?.trim();
    if (firstLine !== "---") return raw;

    const endIdx = lines.slice(1).findIndex((l) => l.trim() === "---");
    if (endIdx === -1) return raw;

    // Return everything after the closing --- (skip the --- line itself)
    const bodyStart = endIdx + 2; // +1 for slice(1) offset, +1 to skip ---
    const body = lines.slice(bodyStart).join("\n");
    return body.trimStart();
  }

  // ==========================================================================
  // Private: Path Rewriting
  // ==========================================================================

  /**
   * Rewrite relative Markdown links and images to absolute paths so the
   * Agent can access auxiliary resources (scripts, templates, data, etc.)
   * in the skill directory via its tools (bash, fs, MCP).
   *
   * Appends a brief note about the skill's root directory so the Agent
   * knows where auxiliary resources live.
   *
   * @param raw       SKILL.md body content (frontmatter already stripped).
   * @param skillDir  Absolute path to the skill directory.
   */
  private _rewriteRelativePaths(raw: string, skillDir: string): string {
    // Match optional leading '!' (image syntax), then [text](relative/path).
    // Skip paths that are already absolute (start with /), external URLs
    // (http/https), or anchor links (#).
    const linkRegex = /(!?)\[([^\]]*)\]\(((?!https?:\/\/|\/|#)[^)]+)\)/g;

    const rewritten = raw.replace(
      linkRegex,
      (_match, bang: string, text: string, relPath: string) => {
        const abs = path.resolve(skillDir, relPath);
        return `${bang}[${text}](${abs})`;
      },
    );

    // Append directory note AFTER the skill body so the LLM reads
    // instructions first, then sees the resource path as a reference.
    return rewritten + `\n(Skill directory: ${skillDir})`;
  }

  // ==========================================================================
  // Private: Frontmatter Parsing
  // ==========================================================================

  /**
   * Manually parse YAML frontmatter (no external dependency).
   * Expects:
   *   ---
   *   key: value
   *   ---
   *   ...markdown body...
   */
  private _parseFrontmatter(content: string): {
    description?: string;
    name?: string;
    disableModelInvocation?: boolean;
  } | null {
    const lines = content.split("\n");

    // Must start with ---
    const firstLine = lines[0]?.trim();
    if (firstLine !== "---") return null;

    // Find closing ---
    const endIdx = lines.slice(1).findIndex((l) => l.trim() === "---");
    if (endIdx === -1) return null;

    const fmLines = lines.slice(1, endIdx + 1); // +1 because slice(1) offset

    const result: Record<string, string> = {};

    for (const line of fmLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "---" || trimmed.startsWith("#")) continue;

      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) continue;

      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();

      if (key) {
        result[key] = value;
      }
    }

    return {
      description: result["description"],
      name: result["name"] || undefined,
      disableModelInvocation:
        result["disable-model-invocation"] === "true" || undefined,
    };
  }
}
