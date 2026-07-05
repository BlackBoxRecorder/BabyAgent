/**
 * Tool adapter — converts MCP tool definitions into the project's Tool interface.
 *
 * Responsibilities:
 * 1. Prefix tool names with server name (e.g. "context7_resolve-library-id")
 * 2. Normalize MCP JSON Schema (defaults, type coercion)
 * 3. Wrap MCP callTool results into ToolResult format
 * 4. Extract text from MCP content arrays
 */
import type {
  Tool,
  JsonSchema,
  JsonSchemaProperty,
} from "../tools/interface/index.js";
import type {
  McpTransport,
  McpToolDef,
  McpContent,
} from "./transports/types.js";

// ============================================================================
// Public API
// ============================================================================

/**
 * Adapt an MCP tool definition into a project Tool instance.
 *
 * @param serverName - The MCP server name (used as prefix).
 * @param mcpTool - The tool definition from tools/list.
 * @param transport - The transport to use for calling this tool.
 */
export function adaptMcpTool(
  serverName: string,
  mcpTool: McpToolDef,
  transport: McpTransport,
): Tool {
  const prefixedName = `${serverName}_${mcpTool.name}`;

  return {
    name: prefixedName,
    description: mcpTool.description ?? `MCP tool from ${serverName}`,
    parameters: normalizeSchema(mcpTool.inputSchema),
    execute: async (params: Record<string, unknown>) => {
      try {
        const result = await transport.callTool(mcpTool.name, params);
        return {
          success: !result.isError,
          output: extractTextContent(result.content),
          error: result.isError
            ? extractTextContent(result.content)
            : undefined,
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

// ============================================================================
// Schema Normalization
// ============================================================================

/**
 * Ensure MCP-provided schema has required defaults (no deep copy needed —
 * JsonSchema and McpToolDef.inputSchema are now the same type).
 */
export function normalizeSchema(schema: JsonSchema): JsonSchema {
  if (!schema) {
    return { type: "object", properties: {} };
  }
  return {
    type: schema.type || "object",
    properties: schema.properties || {},
    required: schema.required,
    additionalProperties: schema.additionalProperties,
    items: schema.items,
    enum: schema.enum,
    description: schema.description,
  };
}

// ============================================================================
// Content Extraction
// ============================================================================

/**
 * Extract plain text from an MCP content array.
 *
 * MCP tools can return text, images, audio, resources, and resource_links.
 * For the LLM context we only care about text content — everything else is
 * represented by a placeholder.
 */
export function extractTextContent(content: McpContent[]): string {
  if (!content || content.length === 0) {
    return "";
  }

  const parts: string[] = [];

  for (const item of content) {
    switch (item.type) {
      case "text":
        parts.push(item.text);
        break;
      case "image":
        parts.push(`[Image: ${item.mimeType}]`);
        break;
      case "audio":
        parts.push(`[Audio: ${item.mimeType}]`);
        break;
      case "resource":
        parts.push(
          item.resource.text
            ? item.resource.text
            : `[Resource: ${item.resource.uri}]`,
        );
        break;
      case "resource_link":
        parts.push(`[Resource: ${item.uri} (${item.name})]`);
        break;
      default:
        // Handle unknown content types gracefully
        parts.push(`[Unknown content type]`);
        break;
    }
  }

  return parts.join("\n");
}
