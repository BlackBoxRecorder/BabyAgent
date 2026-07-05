/**
 * stdio transport — spawns a child process and communicates over stdin/stdout.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig } from "../config.js";
import type {
  McpTransport,
  McpToolDef,
  McpCallToolResult,
  McpContent,
} from "./types.js";
import { withTimeout } from "./with-timeout.js";

/**
 * Create an MCP transport over stdio.
 *
 * Spawns the configured command as a child process and connects
 * to it via the MCP client protocol.
 *
 * @param config - The stdio server config (must have `command`).
 * @param timeoutMs - Connection timeout in milliseconds (default 30s).
 */
export async function createStdioTransport(
  config: McpServerConfig,
  timeoutMs = 30000,
): Promise<McpTransport> {
  if (!("command" in config) || !config.command) {
    throw new Error("stdio transport requires a 'command' field");
  }

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env,
    stderr: "pipe", // Capture stderr for debugging
  });

  const client = new Client(
    { name: "babyAgent", version: "1.0.0" },
    { capabilities: {} },
  );

  // Connect with timeout
  await withTimeout(
    client.connect(transport),
    timeoutMs,
    `Connection to stdio server "${config.command}" timed out after ${timeoutMs}ms`,
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
