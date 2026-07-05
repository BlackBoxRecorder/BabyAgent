/**
 * Tool interface implementations for fs-tool.
 * Wraps the existing fs tools as @timetickme/tools/interface Tool instances.
 */
import type {
  Tool,
  ToolResult as AgentToolResult,
} from "../interface/index.js";
import type { FileOperations, ToolDefinition } from "./core/types.js";
import {
  createReadTool,
  createWriteTool,
  createLsTool,
  createEditTool,
  createGrepTool,
  createFindTool,
  type EditOperations,
} from "./adapters/standalone.js";

/**
 * Create a read tool.
 */
export function createReadToolAsTool(
  cwd: string,
  operations?: FileOperations,
): Tool {
  const tool = createReadTool(cwd, operations);
  return wrapToolDefinition(tool);
}

/**
 * Create a write tool.
 */
export function createWriteToolAsTool(
  cwd: string,
  operations?: FileOperations,
): Tool {
  const tool = createWriteTool(cwd, operations);
  return wrapToolDefinition(tool);
}

/**
 * Create an ls tool.
 */
export function createLsToolAsTool(
  cwd: string,
  operations?: FileOperations,
): Tool {
  const tool = createLsTool(cwd, operations);
  return wrapToolDefinition(tool);
}

/**
 * Create an edit tool.
 */
export function createEditToolAsTool(
  cwd: string,
  operations?: EditOperations,
): Tool {
  const tool = createEditTool(cwd, operations);
  return wrapToolDefinition(tool);
}

/**
 * Create a grep tool.
 */
export function createGrepToolAsTool(cwd: string, rgPath?: string): Tool {
  const tool = createGrepTool(cwd, rgPath);
  return wrapToolDefinition(tool);
}

/**
 * Create a find tool.
 */
export function createFindToolAsTool(cwd: string, fdPath?: string): Tool {
  const tool = createFindTool(cwd, fdPath);
  return wrapToolDefinition(tool);
}

// ============================================================================
// Internal wrapper
// ============================================================================

function wrapToolDefinition(toolDef: ToolDefinition): Tool {
  return {
    name: toolDef.name,
    description: toolDef.description,
    parameters: toolDef.parameters,
    async execute(params: Record<string, any>): Promise<AgentToolResult> {
      try {
        const result = await toolDef.execute(params);

        const outputText = result.content
          .map((item: any) => item.text ?? item.data ?? "")
          .join("\n");

        return {
          success: true,
          output: outputText,
          metadata: result.details as Record<string, any> | undefined,
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

/**
 * Create all fs tools as Tool instances.
 */
export function createAllFsTools(cwd: string): Tool[] {
  return [
    createReadToolAsTool(cwd),
    createWriteToolAsTool(cwd),
    createLsToolAsTool(cwd),
    createEditToolAsTool(cwd),
    createGrepToolAsTool(cwd),
    createFindToolAsTool(cwd),
  ];
}
