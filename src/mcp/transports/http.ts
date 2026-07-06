/**
 * HTTP/Streamable HTTP transport — connects to a remote MCP server via HTTP.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig } from "../config.js";
import type {
  McpTransport,
  McpToolDef,
  McpCallToolResult,
  McpContent,
} from "./types.js";
import { withTimeout } from "./with-timeout.js";

/**
 * Create an MCP transport over HTTP (Streamable HTTP).
 *
 * Connects to a remote MCP server at the given URL using
 * HTTP POST for sending and HTTP GET with SSE for receiving.
 *
 * @param config - The HTTP server config (must have `url`).
 * @param timeoutMs - Connection timeout in milliseconds (default 30s).
 */
export async function createHttpTransport(
  config: McpServerConfig,
  timeoutMs = 30000,
): Promise<McpTransport> {
  if (!("url" in config) || !config.url) {
    throw new Error("HTTP transport requires a 'url' field");
  }

  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: config.headers
      ? { headers: config.headers as Record<string, string> }
      : undefined,
  });

  const client = new Client(
    { name: "babyAgent", version: "1.0.0" },
    { capabilities: {} },
  );

  // Connect with timeout
  await withTimeout(
    client.connect(transport),
    timeoutMs,
    `Connection to HTTP server "${config.url}" timed out after ${timeoutMs}ms`,
  );

  const close = async (): Promise<void> => {
    try {
      await client.close();
    } catch {
      // Ignore close errors
    }
  };

  return {
    client,
    close,
    listTools: async () => {
      const result = await client.listTools();
      // SDK returns generic Record<string,object> for properties;
      // the shapes are compatible at runtime — just narrow the type.
      return result.tools as McpToolDef[];
    },
    callTool: async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool(
        { name, arguments: args },
        undefined,
        { timeout: 60000 },
      );
      // Defensive mapping: SDK return type may differ from McpCallToolResult
      const sdkResult = result as {
        content?: unknown;
        isError?: boolean;
      };
      return {
        content: Array.isArray(sdkResult.content)
          ? (sdkResult.content as McpContent[])
          : [],
        isError: sdkResult.isError,
      } satisfies McpCallToolResult;
    },
  };
}
