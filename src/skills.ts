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

// ============================================================================
// Types
// ============================================================================

/** Parsed skill metadata (body not loaded). */
export interface SkillMeta {
  name: string;
  description: string;
  location: string; // SKILL.md absolute path
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
   * Format skills for system prompt.
   * Only includes skills where disableModelInvocation !== true.
   */
  formatSkillsForSystemPrompt(): string {
    const visible = this.skills.filter((s) => !s.disableModelInvocation);
    if (visible.length === 0) return "";

    const lines: string[] = [
      "The following skills provide specialized instructions for specific tasks.",
      "Read the full skill file when the task matches its description.",
      "When a skill file references a relative path, resolve it against the skill directory.",
      "",
      "<available_skills>",
    ];

    for (const skill of visible) {
      lines.push("  <skill>");
      lines.push(`    <name>${skill.name}</name>`);
      lines.push(`    <description>${skill.description}</description>`);
      lines.push(`    <location>${skill.location}</location>`);
      lines.push("  </skill>");
    }

    lines.push("</available_skills>");
    return lines.join("\n");
  }

  /** Read a skill's full SKILL.md content on demand. */
  async readSkillContent(name: string): Promise<string> {
    const skill = this.getSkill(name);
    if (!skill) {
      throw new Error(`Skill "${name}" not found.`);
    }
    return fs.readFile(skill.location, "utf-8");
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
        name: parsed.name ?? entryName,
        description: parsed.description,
        location: skillMdPath,
        source,
        disableModelInvocation: parsed.disableModelInvocation ?? false,
      });
    }

    return skills;
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
