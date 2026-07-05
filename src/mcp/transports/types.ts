/**
 * Shared transport types for MCP client connections.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { JsonSchema } from "../tools/interface/index.js";

/**
 * Unified transport interface used by both stdio and HTTP/SSE transports.
 * Wraps the SDK's Client and provides a simplified API.
 */
export interface McpTransport {
  /** The underlying MCP Client instance. */
  client: Client;

  /** List all tools available on this server. */
  listTools: () => Promise<McpToolDef[]>;

  /** Call a specific tool with arguments. */
  callTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<McpCallToolResult>;

  /** Close the transport connection and release resources. */
  close: () => Promise<void>;
}

/**
 * Tool definition returned by MCP servers (from tools/list).
 */
export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
}

/**
 * Content returned by a tool call.
 * Can be text, image, audio, resource, or resource_link.
 */
export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | {
      type: "resource";
      resource: {
        uri: string;
        mimeType?: string;
        text?: string;
        blob?: string;
      };
    }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      description?: string;
      mimeType?: string;
      size?: number;
    };

/**
 * Result of calling a tool on an MCP server.
 *
 * The SDK returns a richer type than we need; we cast to this simplified view.
 */
export interface McpCallToolResult {
  content: McpContent[];
  isError?: boolean;
}
