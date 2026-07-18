import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { SkillManager } from "../../src/skills.js";

// ============================================================================
// Helpers
// ============================================================================

async function createSkillDir(
  baseDir: string,
  name: string,
  content: string,
): Promise<string> {
  const dir = path.join(baseDir, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), content, "utf-8");
  return dir;
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "babyAgent-skill-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("SkillManager", () => {
  describe("loadSkills", () => {
    it("returns empty array when no skill directories exist", async () => {
      await withTempDir(async (tmp) => {
        const mgr = new SkillManager(
          path.join(tmp, "nonexistent-user"),
          path.join(tmp, "nonexistent-project"),
        );
        const skills = await mgr.loadSkills();
        expect(skills).toEqual([]);
      });
    });

    it("loads skills from user directory", async () => {
      await withTempDir(async (tmp) => {
        const userDir = path.join(tmp, "user-skills");
        await createSkillDir(
          userDir,
          "hello",
          "---\ndescription: A greeting skill\n---\n\n# Hello\nSay hello.",
        );

        const mgr = new SkillManager(userDir, path.join(tmp, "nonexistent"));
        const skills = await mgr.loadSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0].name).toBe("hello");
        expect(skills[0].description).toBe("A greeting skill");
        expect(skills[0].source).toBe("user");
        expect(skills[0].disableModelInvocation).toBe(false);
        expect(skills[0].location).toContain("SKILL.md");
      });
    });

    it("loads skills from project directory", async () => {
      await withTempDir(async (tmp) => {
        const projectDir = path.join(tmp, "project-skills");
        await createSkillDir(
          projectDir,
          "review",
          "---\ndescription: Code review skill\n---\n\n# Review",
        );

        const mgr = new SkillManager(path.join(tmp, "nonexistent"), projectDir);
        const skills = await mgr.loadSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0].name).toBe("review");
        expect(skills[0].source).toBe("project");
      });
    });

    it("project skill overrides user skill with same name", async () => {
      await withTempDir(async (tmp) => {
        const userDir = path.join(tmp, "user");
        const projectDir = path.join(tmp, "project");

        await createSkillDir(
          userDir,
          "shared",
          "---\ndescription: User version\n---\n\n# User",
        );
        await createSkillDir(
          projectDir,
          "shared",
          "---\ndescription: Project version\n---\n\n# Project",
        );

        const mgr = new SkillManager(userDir, projectDir);
        const skills = await mgr.loadSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0].description).toBe("Project version");
        expect(skills[0].source).toBe("project");
      });
    });

    it("uses directory name when frontmatter name is absent", async () => {
      await withTempDir(async (tmp) => {
        await createSkillDir(
          tmp,
          "dir-name",
          "---\ndescription: Test\n---\n\n# Content",
        );

        const mgr = new SkillManager(tmp, path.join(tmp, "nonexistent"));
        const skills = await mgr.loadSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0].name).toBe("dir-name");
      });
    });

    it("parses disable-model-invocation as true", async () => {
      await withTempDir(async (tmp) => {
        await createSkillDir(
          tmp,
          "hidden",
          "---\ndescription: Hidden skill\ndisable-model-invocation: true\n---\n\n# Hidden",
        );

        const mgr = new SkillManager(tmp, path.join(tmp, "nonexistent"));
        const skills = await mgr.loadSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0].disableModelInvocation).toBe(true);
      });
    });

    it("skips skill with missing description", async () => {
      await withTempDir(async (tmp) => {
        await createSkillDir(
          tmp,
          "no-desc",
          "---\nname: test\n---\n\n# No description",
        );

        const mgr = new SkillManager(tmp, path.join(tmp, "nonexistent"));
        const skills = await mgr.loadSkills();

        expect(skills).toHaveLength(0);
      });
    });

    it("skips skill with no frontmatter", async () => {
      await withTempDir(async (tmp) => {
        await createSkillDir(tmp, "no-fm", "# No frontmatter\n\nJust content.");

        const mgr = new SkillManager(tmp, path.join(tmp, "nonexistent"));
        const skills = await mgr.loadSkills();

        expect(skills).toHaveLength(0);
      });
    });

    it("skips hidden directories", async () => {
      await withTempDir(async (tmp) => {
        await createSkillDir(
          tmp,
          ".hidden-dir",
          "---\ndescription: Hidden\n---\n\n# Hidden",
        );
        await createSkillDir(
          tmp,
          "visible-dir",
          "---\ndescription: Visible\n---\n\n# Visible",
        );

        const mgr = new SkillManager(tmp, path.join(tmp, "nonexistent"));
        const skills = await mgr.loadSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0].name).toBe("visible-dir");
      });
    });
  });

  describe("getSkill", () => {
    it("finds skill by name", async () => {
      await withTempDir(async (tmp) => {
        await createSkillDir(
          tmp,
          "test",
          "---\ndescription: Test skill\n---\n\n# Test",
        );

        const mgr = new SkillManager(tmp, path.join(tmp, "nonexistent"));
        await mgr.loadSkills();

        const skill = mgr.getSkill("test");
        expect(skill).toBeDefined();
        expect(skill!.name).toBe("test");
      });
    });

    it("returns undefined for unknown skill", async () => {
      await withTempDir(async (tmp) => {
        const mgr = new SkillManager(tmp, path.join(tmp, "nonexistent"));
        await mgr.loadSkills();

        expect(mgr.getSkill("nonexistent")).toBeUndefined();
      });
    });

    it("finds disabled skill", async () => {
      await withTempDir(async (tmp) => {
        await createSkillDir(
          tmp,
          "hidden",
          "---\ndescription: Hidden\ndisable-model-invocation: true\n---\n\n# Hidden",
        );

        const mgr = new SkillManager(tmp, path.join(tmp, "nonexistent"));
        await mgr.loadSkills();

        expect(mgr.getSkill("hidden")).toBeDefined();
      });
    });
  });

  describe("readSkillContent", () => {
    it("reads full SKILL.md content with frontmatter stripped", async () => {
      await withTempDir(async (tmp) => {
        const content =
          "---\ndescription: Test\n---\n\n# Hello World\n\nThis is content.";
        await createSkillDir(tmp, "test", content);

        const mgr = new SkillManager(tmp, path.join(tmp, "nonexistent"));
        await mgr.loadSkills();

        const result = await mgr.readSkillContent("test");
        // Body content preserved after frontmatter stripping
        expect(result).toContain("# Hello World");
        expect(result).toContain("This is content.");
        // Frontmatter should be stripped from the injected content
        expect(result).not.toContain("description: Test");
        // Should include the skill directory note at the end
        expect(result).toContain("(Skill directory:");
      });
    });

    it("throws for unknown skill", async () => {
      await withTempDir(async (tmp) => {
        const mgr = new SkillManager(tmp, path.join(tmp, "nonexistent"));
        await mgr.loadSkills();

        await expect(mgr.readSkillContent("unknown")).rejects.toThrow(
          'Skill "unknown" not found.',
        );
      });
    });
  });

  describe("formatSkillsForSystemPrompt", () => {
    it("returns empty string when no skills", async () => {
      await withTempDir(async (tmp) => {
        const mgr = new SkillManager(tmp, path.join(tmp, "nonexistent"));
        await mgr.loadSkills();

        expect(mgr.formatSkillsForSystemPrompt()).toBe("");
      });
    });

    it("formats visible skills for system prompt", async () => {
      await withTempDir(async (tmp) => {
        await createSkillDir(
          tmp,
          "fixbug",
          "---\ndescription: 修复 Bug 的技能\n---\n\n# Fix Bug\nStep by step.",
        );

        const mgr = new SkillManager(tmp, path.join(tmp, "nonexistent"));
        await mgr.loadSkills();

        const result = mgr.formatSkillsForSystemPrompt();

        // Should contain skill catalog with name, description, location
        expect(result).toContain("<available_skills>");
        expect(result).toContain("<name>fixbug</name>");
        expect(result).toContain("修复 Bug 的技能");
        expect(result).toContain("<location>");
        expect(result).toContain("SKILL.md");
        expect(result).toContain("</available_skills>");
      });
    });

    it("excludes disabled skills", async () => {
      await withTempDir(async (tmp) => {
        await createSkillDir(
          tmp,
          "visible",
          "---\ndescription: Visible skill\n---\n\n# Visible",
        );
        await createSkillDir(
          tmp,
          "hidden",
          "---\ndescription: Hidden skill\ndisable-model-invocation: true\n---\n\n# Hidden",
        );

        const mgr = new SkillManager(tmp, path.join(tmp, "nonexistent"));
        await mgr.loadSkills();

        const result = mgr.formatSkillsForSystemPrompt();

        expect(result).toContain("visible");
        expect(result).not.toContain("hidden");
      });
    });
  });

  describe("readSkillContent", () => {
    it("reads SKILL.md content with frontmatter stripped", async () => {
      await withTempDir(async (tmp) => {
        const content = "---\ndescription: Test\n---\n\n# Hello\n\nCache me.";
        await createSkillDir(tmp, "test", content);

        const mgr = new SkillManager(tmp, path.join(tmp, "nonexistent"));
        await mgr.loadSkills();

        const result = await mgr.readSkillContent("test");
        // Body content preserved after frontmatter stripping
        expect(result).toContain("# Hello");
        expect(result).toContain("Cache me.");
        // Frontmatter should be stripped from the injected content
        expect(result).not.toContain("description: Test");
        // Should include the skill directory note at the end
        expect(result).toContain("(Skill directory:");
      });
    });
  });

  describe("description with special characters", () => {
    it("handles colons in description value", async () => {
      await withTempDir(async (tmp) => {
        await createSkillDir(
          tmp,
          "test",
          "---\ndescription: Use when: user wants PDF\n---\n\n# Test",
        );

        const mgr = new SkillManager(tmp, path.join(tmp, "nonexistent"));
        const skills = await mgr.loadSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0].description).toBe("Use when: user wants PDF");
      });
    });

    it("handles multi-line frontmatter with continuous lines", async () => {
      await withTempDir(async (tmp) => {
        await createSkillDir(
          tmp,
          "test",
          "---\n# comment line\ndescription: Test skill\n---\n\n# Content",
        );

        const mgr = new SkillManager(tmp, path.join(tmp, "nonexistent"));
        const skills = await mgr.loadSkills();

        expect(skills).toHaveLength(1);
        expect(skills[0].description).toBe("Test skill");
      });
    });
  });
});
