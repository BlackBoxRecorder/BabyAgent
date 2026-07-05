/**
 * MCP configuration parsing and validation.
 *
 * Reads ~/.babyAgent/mcp.json and produces a validated McpConfig.
 * Compatible with Claude Code / VS Code MCP configuration format.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ============================================================================
// Types
// ============================================================================

/** stdio transport configuration. */
export interface StdioServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** HTTP/SSE transport configuration. */
export interface HttpServerConfig {
  url: string;
  headers?: Record<string, string>;
}

/** A single MCP server config — discriminated by transport. */
export type McpServerConfig = StdioServerConfig | HttpServerConfig;

/** Full MCP configuration from mcp.json. */
export interface McpConfig {
  /** Map of server name → server config. May be empty if no config file. */
  servers: Record<string, McpServerConfig>;
}

// ============================================================================
// Validation
// ============================================================================

/** kebab-case: lowercase letters, digits, hyphens, must start with a letter. */
const KEBAB_CASE_RE = /^[a-z][a-z0-9-]*$/;

/** Validation error for a single server. */
export interface ServerValidationError {
  name: string;
  message: string;
}

/**
 * Validate a single server config entry.
 * Returns an error array (empty = valid).
 */
function validateServerEntry(
  name: string,
  cfg: Record<string, unknown>,
): ServerValidationError[] {
  const errors: ServerValidationError[] = [];

  // Name must be kebab-case
  if (!KEBAB_CASE_RE.test(name)) {
    errors.push({
      name,
      message: `Server name "${name}" must be kebab-case (e.g. "my-server")`,
    });
    return errors; // Stop early — invalid name
  }

  const hasCommand = typeof cfg.command === "string" && cfg.command.length > 0;
  const hasUrl = typeof cfg.url === "string" && cfg.url.length > 0;

  if (hasCommand && hasUrl) {
    errors.push({
      name,
      message: `Server "${name}": both "command" and "url" are set — must specify exactly one transport`,
    });
  } else if (!hasCommand && !hasUrl) {
    errors.push({
      name,
      message: `Server "${name}": neither "command" nor "url" is set — must specify at least one`,
    });
  }

  // Validate stdio fields
  if (hasCommand && cfg.args !== undefined) {
    if (
      !Array.isArray(cfg.args) ||
      cfg.args.some((a) => typeof a !== "string")
    ) {
      errors.push({
        name,
        message: `Server "${name}": "args" must be an array of strings`,
      });
    }
  }

  if (hasCommand && cfg.env !== undefined) {
    if (
      typeof cfg.env !== "object" ||
      cfg.env === null ||
      Array.isArray(cfg.env)
    ) {
      errors.push({
        name,
        message: `Server "${name}": "env" must be an object`,
      });
    }
  }

  // Validate http fields
  if (hasUrl && cfg.headers !== undefined) {
    if (
      typeof cfg.headers !== "object" ||
      cfg.headers === null ||
      Array.isArray(cfg.headers)
    ) {
      errors.push({
        name,
        message: `Server "${name}": "headers" must be an object`,
      });
    }
  }

  return errors;
}

/**
 * Validate the full MCP configuration.
 * Returns a list of per-server validation errors (empty = all valid).
 */
export function validateConfig(cfg: McpConfig): ServerValidationError[] {
  const allErrors: ServerValidationError[] = [];
  const seenNames = new Set<string>();

  for (const [name, serverCfg] of Object.entries(cfg.servers)) {
    // Duplicate name? Only the first occurrence is valid
    if (seenNames.has(name)) {
      allErrors.push({
        name,
        message: `Duplicate server name "${name}" — skipping (first occurrence used)`,
      });
      continue;
    }
    seenNames.add(name);

    allErrors.push(
      ...validateServerEntry(
        name,
        serverCfg as unknown as Record<string, unknown>,
      ),
    );
  }

  return allErrors;
}

// ============================================================================
// Loading
// ============================================================================

/**
 * Default path for the MCP configuration file.
 */
export function defaultConfigPath(): string {
  return path.join(os.homedir(), ".babyAgent", "mcp.json");
}

/**
 * Load and validate the MCP configuration file.
 *
 * Returns an empty config if the file doesn't exist.
 * Throws on JSON parse errors (caller should catch and warn).
 *
 * @param configPath Path to mcp.json. Defaults to ~/.babyAgent/mcp.json.
 */
export function loadConfig(configPath?: string): {
  config: McpConfig;
  errors: ServerValidationError[];
} {
  const filePath = configPath ?? defaultConfigPath();

  // File doesn't exist → empty config, not an error
  if (!fs.existsSync(filePath)) {
    return { config: { servers: {} }, errors: [] };
  }

  let raw: unknown;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    raw = JSON.parse(content);
  } catch (err) {
    throw new Error(
      `Failed to parse MCP config "${filePath}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // Schema: { mcpServers: { name: { ... } } }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Invalid MCP config "${filePath}": root must be an object`);
  }

  const rawObj = raw as Record<string, unknown>;
  const serversRaw = rawObj.mcpServers;

  if (serversRaw === undefined) {
    return { config: { servers: {} }, errors: [] };
  }

  if (
    typeof serversRaw !== "object" ||
    serversRaw === null ||
    Array.isArray(serversRaw)
  ) {
    throw new Error(
      `Invalid MCP config "${filePath}": "mcpServers" must be an object`,
    );
  }

  const cfg: McpConfig = {
    servers: serversRaw as unknown as Record<string, McpServerConfig>,
  };
  const errors = validateConfig(cfg);

  return { config: cfg, errors };
}
