/**
 * JSON Schema property definition, compatible with DeepSeek tool call format.
 */
export interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: any[];
  required?: string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  /** Default value for the property (MCP compatibility). */
  default?: unknown;
}

/**
 * JSON Schema definition for tool parameters.
 * Compatible with DeepSeek API and MCP tool specifications.
 */
export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  /** For array schemas at root level (MCP compatibility). */
  items?: JsonSchemaProperty;
  /** Enum values at schema level (MCP compatibility). */
  enum?: string[];
  /** Description at schema level (MCP compatibility). */
  description?: string;
}

/**
 * Result returned by a tool execution.
 */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Tool interface that all tools must implement.
 */
export interface Tool {
  /** Unique tool name, used for identification */
  name: string;
  /** Tool description, used by LLM to understand tool capabilities */
  description: string;
  /** JSON Schema parameter definition, compatible with DeepSeek format */
  parameters: JsonSchema;
  /** Execute the tool with given parameters */
  execute: (params: Record<string, any>) => Promise<ToolResult>;
}

/**
 * Tool registry for managing and looking up tools.
 */
export interface ToolRegistry {
  /** Register a new tool */
  register(tool: Tool): void;
  /** Get a tool by name */
  getTool(name: string): Tool | undefined;
  /** Get all registered tools */
  getAllTools(): Tool[];
  /** Get tools formatted for LLM (DeepSeek API format) */
  getToolsForLLM(): LLMFunctionDef[];
}

// ============================================================================
// LLM Tool Format (DeepSeek API)
// ============================================================================

/**
 * Tool definition in LLM function-calling format.
 * Matches the DeepSeek tools parameter shape.
 */
export interface LLMFunctionDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

/**
 * Convert a Tool to its LLM-compatible function definition.
 */
export function formatToolForLLM(tool: Tool): LLMFunctionDef {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

export { DefaultToolRegistry } from "./registry.js";
