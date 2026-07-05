/**
 * @timetickme/mcp — MCP (Model Context Protocol) client integration.
 *
 * Provides McpManager to connect to MCP servers, discover tools,
 * and adapt them to the project's Tool interface for the Agent.
 */
export { McpManager } from "./mcp-manager.js";
export type { ServerStatus } from "./mcp-manager.js";
export type { McpConfig, McpServerConfig } from "./config.js";
export { loadConfig, validateConfig } from "./config.js";
