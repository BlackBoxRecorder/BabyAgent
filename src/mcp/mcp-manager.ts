/**
 * McpManager — orchestrates MCP server connections, tool discovery, and adaptation.
 *
 * Central entry point: loadAllTools() connects to all configured servers,
 * discovers tools, wraps them as project Tool instances, and returns the
 * combined list. Failed servers are skipped with stderr warnings.
 */
import type { Tool } from "../tools/interface/index.js";
import { loadConfig, type McpServerConfig } from "./config.js";
import { createStdioTransport } from "./transports/stdio.js";
import { createHttpTransport } from "./transports/http.js";
import { adaptMcpTool } from "./tool-adapter.js";
import type { McpTransport } from "./transports/types.js";

// ============================================================================
// Types
// ============================================================================

/** Status of a single MCP server connection. */
export interface ServerStatus {
  name: string;
  transport: "stdio" | "http";
  ok: boolean;
  toolCount: number;
  error?: string;
}

// ============================================================================
// McpManager
// ============================================================================

export class McpManager {
  private configPath: string;
  private transports: McpTransport[] = [];
  private _serverStatuses: ServerStatus[] = [];

  /**
   * @param configPath Path to mcp.json. Defaults to ~/.deepcode/mcp.json.
   */
  constructor(configPath?: string) {
    this.configPath = configPath ?? ""; // default resolved in loadAllTools
  }

  /**
   * Connect to all configured MCP servers, discover tools, and return
   * them as project Tool instances.
   *
   * Individual server failures are logged to stderr and skipped —
   * the Agent will still start with the successfully loaded tools.
   */
  async loadAllTools(): Promise<Tool[]> {
    // Load and validate config
    const { config, errors } = loadConfig(this.configPath || undefined);

    // Report validation errors
    for (const err of errors) {
      console.error(`[MCP] ${err.name}: ${err.message}`);
    }

    const allTools: Tool[] = [];

    for (const [name, serverCfg] of Object.entries(config.servers)) {
      const transportType = detectTransportType(serverCfg);

      try {
        // Create transport based on config type
        const t = await this.createTransport(name, serverCfg);
        this.transports.push(t);

        // Discover tools
        const mcpTools = await t.listTools();

        // Adapt each tool
        const adaptedTools = mcpTools.map((mcpTool) => {
          try {
            return adaptMcpTool(name, mcpTool, t);
          } catch (toolErr) {
            console.error(
              `[MCP] ${name}_${mcpTool.name}: failed to adapt — ${
                toolErr instanceof Error ? toolErr.message : String(toolErr)
              }`,
            );
            return null;
          }
        });

        const validTools = adaptedTools.filter(
          (tool): tool is Tool => tool !== null,
        );

        this._serverStatuses.push({
          name,
          transport: transportType,
          ok: true,
          toolCount: validTools.length,
        });

        allTools.push(...validTools);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[MCP] ${name}: connection failed — ${errorMsg}`);

        this._serverStatuses.push({
          name,
          transport: transportType,
          ok: false,
          toolCount: 0,
          error: errorMsg,
        });
      }
    }

    return allTools;
  }

  /**
   * Return the status of all configured MCP servers.
   * Call after loadAllTools() for accurate results.
   */
  getServerStatuses(): ServerStatus[] {
    return [...this._serverStatuses];
  }

  /**
   * Disconnect from all MCP servers and release resources.
   */
  async dispose(): Promise<void> {
    for (const t of this.transports) {
      try {
        await t.close();
      } catch (err) {
        console.error(
          `[MCP] Error closing transport:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    this.transports = [];
    this._serverStatuses = [];
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Determine the transport type from a server config.
   */
  /**
   * Create the appropriate transport for a server config.
   */
  private async createTransport(
    name: string,
    cfg: McpServerConfig,
  ): Promise<McpTransport> {
    if ("command" in cfg && cfg.command) {
      return createStdioTransport(cfg);
    }
    if ("url" in cfg && cfg.url) {
      return createHttpTransport(cfg);
    }
    throw new Error(
      `Server "${name}": invalid config — must have "command" or "url"`,
    );
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Detect the transport type from a server config object.
 */
function detectTransportType(cfg: McpServerConfig): "stdio" | "http" {
  if ("command" in cfg && cfg.command) return "stdio";
  if ("url" in cfg && cfg.url) return "http";
  // Should not happen after validation, but default to stdio
  return "stdio";
}
