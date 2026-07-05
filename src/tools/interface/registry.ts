import type { Tool, ToolRegistry, LLMFunctionDef } from "./index.js";
import { formatToolForLLM } from "./index.js";

/**
 * Default in-memory implementation of ToolRegistry.
 * Maintains a map of tool name -> Tool.
 */
export class DefaultToolRegistry implements ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Convert registered tools to DeepSeek-compatible tools array format.
   */
  getToolsForLLM(): LLMFunctionDef[] {
    return this.getAllTools().map(formatToolForLLM);
  }
}
