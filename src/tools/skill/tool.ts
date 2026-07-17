/**
 * Skill meta-tool — a dedicated tool for loading and activating skills.
 *
 * Follows the Claude Code pattern: the Skill tool's description dynamically
 * lists all available skills (name + description), and the model invokes it
 * by calling Skill("skill-name").
 *
 * The Skill tool is **pure** — it has no side effects during execution.
 * It returns the loaded skill content in `metadata.skillContent`.  The agent
 * loop (agent.ts) detects Skill tool results and injects the content as a
 * system message into the active conversation, ensuring the model sees the
 * skill instructions on the very next iteration in the same turn.
 *
 */
import type { Tool, ToolResult, JsonSchema } from "../interface/index.js";
import type { SkillManager } from "../../skills.js";

// ============================================================================
// Factory
// ============================================================================

/**
 * Create the Skill meta-tool.
 *
 * @param skillManager  SkillManager instance (for content loading + description).
 */
export function createSkillTool(skillManager: SkillManager): Tool {
  return {
    name: "Skill",

    // Description is set once at construction time (skills are static at startup).
    description: skillManager.formatSkillsForToolDescription(),

    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "技能名称（不带参数）。例如 'fixbug' 或 'code-review'。只使用工具描述中列出的技能。",
        },
      },
      required: ["command"],
    } as JsonSchema,

    async execute(params: Record<string, any>): Promise<ToolResult> {
      const skillName = (params.command as string)?.trim();
      if (!skillName) {
        return {
          success: false,
          output: "",
          error: "Skill name is required",
        };
      }

      // ------------------------------------------------------------------
      // Load skill content (uses in-memory cache, no duplicate disk I/O)
      // ------------------------------------------------------------------
      let content: string;
      try {
        content = await skillManager.readSkillContent(skillName);
      } catch {
        return {
          success: false,
          output: "",
          error: `Skill "${skillName}" not found. Use only skills listed in the tool description.`,
        };
      }

      // ------------------------------------------------------------------
      // Return content in metadata — the agent loop handles injection.
      // Dedup is handled by the agent loop checking for existing skill
      // system messages before injecting.
      // ------------------------------------------------------------------
      const hash = skillManager.getSkillContentHash(skillName);

      return {
        success: true,
        output: [
          `<command-message>The "${skillName}" skill is loading</command-message>`,
          `<command-name>${skillName}</command-name>`,
        ].join("\n"),
        metadata: {
          skillName,
          skillContent: content,
          skillContentHash: hash ?? "",
        },
      };
    },
  };
}
