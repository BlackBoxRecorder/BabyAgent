/**
 * SkillManager — discovers, loads, and manages agent skills.
 *
 * Skills are directories containing a SKILL.md with YAML frontmatter.
 * The manager scans two locations:
 *   - ~/.babyAgent/skills/          (user-level)
 *   - cwd/.babyAgent/skills/         (project-level)
 *
 * Project-level skills override user-level skills with the same name.
 *
 * Skills are disclosed to the model via the system prompt (tier 1 of
 * progressive disclosure).  The model activates a skill by reading its
 * SKILL.md file with the standard file-read tool.  No dedicated Skill
 * meta-tool is needed — the simplest approach per the Agent Skills guide.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// ============================================================================
// Types
// ============================================================================

/** Parsed skill metadata (body not loaded). */
export interface SkillMeta {
  name: string;
  description: string;
  source: "user" | "project";
  /** Absolute path to the SKILL.md file. */
  location: string;
  /** When true, the skill is NOT disclosed to the model in the system prompt.
   *  It can still be activated via slash commands (/skill:<name>). */
  disableModelInvocation: boolean;
}

// ============================================================================
// SkillManager
// ============================================================================

export class SkillManager {
  private skills: SkillMeta[] = [];
  private userSkillsDir: string;
  private projectSkillsDir: string;

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

  /** Find a skill by name. */
  getSkill(name: string): SkillMeta | undefined {
    return this.skills.find((s) => s.name === name);
  }

  /**
   * Read a skill's SKILL.md body content (frontmatter stripped).
   * Used by slash-command activation (/skill:<name>).
   * No caching — always reads from disk to pick up changes.
   */
  async readSkillContent(name: string): Promise<string> {
    const skill = this.getSkill(name);
    if (!skill) {
      throw new Error(`Skill "${name}" not found.`);
    }

    const raw = await fs.readFile(skill.location, "utf-8");
    const bodyOnly = this._stripFrontmatter(raw);

    // Append directory note so the model knows where auxiliary resources live
    const skillDir = path.dirname(skill.location);
    return bodyOnly + `\n(Skill directory: ${skillDir})`;
  }

  /**
   * Format the skill catalog for the system prompt.
   * Only includes visible skills (disableModelInvocation !== true).
   * Returns empty string if no skills available.
   *
   * Format follows the Agent Skills guide: XML-style <available_skills>
   * with name, description, and location for each skill.
   */
  formatSkillsForSystemPrompt(): string {
    const visible = this.skills.filter((s) => !s.disableModelInvocation);
    if (visible.length === 0) return "";

    const instructions = [
      "The following skills provide specialized instructions for specific tasks.",
      "When a task matches a skill's description, use your file-read tool to load",
      "the SKILL.md at the listed location before proceeding.",
      "When a skill references relative paths, resolve them against the skill's",
      "directory (the parent of SKILL.md) and use absolute paths in tool calls.",
    ].join("\n");

    const skillEntries = visible.map(
      (s) =>
        `  <skill>\n    <name>${s.name}</name>\n    <description>${s.description}</description>\n    <location>${s.location}</location>\n  </skill>`,
    );

    return [
      instructions,
      "",
      "<available_skills>",
      ...skillEntries,
      "</available_skills>",
    ].join("\n");
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
        location: skillMdPath,
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
