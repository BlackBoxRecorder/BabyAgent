/**
 * Tool interface implementation for bash-tool.
 * Wraps the existing bash tool as a @timetickme/tools/interface Tool.
 */
import type { Tool, ToolResult } from "../interface/index.js";
import { createBashTool } from "./bash.js";
import type { BashToolOptions } from "./types.js";

/**
 * Create a Tool-compatible bash tool.
 *
 * @param cwd Working directory for command execution
 * @param options Optional bash tool options
 * @returns A Tool instance
 */
export function createBashToolAsTool(
  cwd: string,
  options?: BashToolOptions,
): Tool {
  const bashTool = createBashTool(cwd, options);

  return {
    name: "bash",
    description:
      "Execute bash commands in the terminal. Use this to run shell commands, " +
      "manage files, install packages, run scripts, and perform any terminal operations.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The bash command to execute",
        },
        timeout: {
          type: "number",
          description: "Optional timeout in seconds for the command",
        },
      },
      required: ["command"],
    },
    async execute(params: Record<string, any>): Promise<ToolResult> {
      try {
        const result = await bashTool({
          command: params.command,
          timeout: params.timeout,
        });

        // Extract text from content items
        const outputText = result.content.map((item) => item.text).join("\n");

        const exitCode = result.details?.exitCode;
        return {
          success: exitCode === 0 || exitCode === null,
          output: outputText,
          error:
            exitCode !== undefined && exitCode !== 0 && exitCode !== null
              ? `Exit code: ${exitCode}`
              : undefined,
          metadata: result.details,
        };
      } catch (err) {
        return {
          success: false,
          output: "",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
