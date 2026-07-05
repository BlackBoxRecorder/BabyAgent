/**
 * Unit tests for config.ts — MCP config parsing and validation.
 */
import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadConfig,
  validateConfig,
  type McpConfig,
} from "../../src/mcp/config.js";

const TMP_DIR = path.join(os.tmpdir(), "babyAgent-mcp-test-" + Date.now());

function writeConfig(filename: string, content: object | string): string {
  const filePath = path.join(TMP_DIR, filename);
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(
    filePath,
    typeof content === "string" ? content : JSON.stringify(content),
    "utf-8",
  );
  return filePath;
}

function cleanup(): void {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe("loadConfig", () => {
  afterAll(cleanup);

  it("returns empty config if file does not exist", () => {
    const { config, errors } = loadConfig("/nonexistent/path/mcp.json");
    expect(config.servers).toEqual({});
    expect(errors).toHaveLength(0);
  });

  it("parses a valid stdio-only config", () => {
    const filePath = writeConfig("valid-stdio.json", {
      mcpServers: {
        "my-server": {
          command: "node",
          args: ["server.js"],
        },
      },
    });

    const { config, errors } = loadConfig(filePath);
    expect(errors).toHaveLength(0);
    expect(config.servers["my-server"]).toEqual({
      command: "node",
      args: ["server.js"],
    });
  });

  it("parses a valid http-only config", () => {
    const filePath = writeConfig("valid-http.json", {
      mcpServers: {
        "remote-srv": {
          url: "http://localhost:3000/sse",
        },
      },
    });

    const { config, errors } = loadConfig(filePath);
    expect(errors).toHaveLength(0);
    expect(config.servers["remote-srv"]).toEqual({
      url: "http://localhost:3000/sse",
    });
  });

  it("returns empty config if mcpServers is missing", () => {
    const filePath = writeConfig("no-servers.json", { other: "stuff" });

    const { config, errors } = loadConfig(filePath);
    expect(config.servers).toEqual({});
    expect(errors).toHaveLength(0);
  });

  it("throws on invalid JSON", () => {
    const filePath = writeConfig("bad.json", "not json {{{");

    expect(() => loadConfig(filePath)).toThrow("Failed to parse MCP config");
  });

  it("throws on non-object root", () => {
    const filePath = writeConfig("array.json", ["not", "an", "object"]);

    expect(() => loadConfig(filePath)).toThrow("root must be an object");
  });

  it("throws on non-object mcpServers", () => {
    const filePath = writeConfig("bad-servers.json", {
      mcpServers: "not-an-object",
    });

    expect(() => loadConfig(filePath)).toThrow(
      '"mcpServers" must be an object',
    );
  });
});

describe("validateConfig", () => {
  it("accepts valid stdio config", () => {
    const cfg: McpConfig = {
      servers: {
        "my-server": { command: "echo", args: ["hello"] },
      },
    };
    expect(validateConfig(cfg)).toHaveLength(0);
  });

  it("accepts valid http config", () => {
    const cfg: McpConfig = {
      servers: {
        remote: { url: "http://localhost/sse" },
      },
    };
    expect(validateConfig(cfg)).toHaveLength(0);
  });

  it("rejects non-kebab-case name", () => {
    const cfg: McpConfig = {
      servers: {
        My_Server: { command: "echo" },
      },
    };
    const errors = validateConfig(cfg);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("kebab-case");
  });

  it("rejects name starting with digit", () => {
    const cfg: McpConfig = {
      servers: {
        "123bad": { command: "echo" },
      },
    };
    const errors = validateConfig(cfg);
    expect(errors).toHaveLength(1);
  });

  it("rejects both command and url", () => {
    const cfg: McpConfig = {
      servers: {
        "my-server": { command: "echo", url: "http://localhost/sse" },
      },
    };
    const errors = validateConfig(cfg);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("both");
  });

  it("rejects neither command nor url", () => {
    const cfg: McpConfig = {
      servers: {
        "my-server": {} as any,
      },
    };
    const errors = validateConfig(cfg);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("neither");
  });

  it("handles empty servers", () => {
    const cfg: McpConfig = { servers: {} };
    expect(validateConfig(cfg)).toHaveLength(0);
  });

  it("rejects non-array args", () => {
    const cfg: McpConfig = {
      servers: {
        "my-server": { command: "echo", args: "not-array" } as any,
      },
    };
    const errors = validateConfig(cfg);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("args");
  });

  it("rejects args array with non-string elements", () => {
    const cfg: McpConfig = {
      servers: {
        "my-server": { command: "echo", args: [1, true, null] } as any,
      },
    };
    const errors = validateConfig(cfg);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("args");
  });

  it("rejects non-object env", () => {
    const cfg: McpConfig = {
      servers: {
        "my-server": { command: "echo", env: "not-object" } as any,
      },
    };
    const errors = validateConfig(cfg);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("env");
  });

  it("accepts valid env object", () => {
    const cfg: McpConfig = {
      servers: {
        "my-server": { command: "echo", env: { NODE_ENV: "production" } },
      },
    };
    expect(validateConfig(cfg)).toHaveLength(0);
  });

  it("accepts valid headers for http", () => {
    const cfg: McpConfig = {
      servers: {
        remote: {
          url: "http://localhost/sse",
          headers: { Authorization: "Bearer x" },
        },
      },
    };
    expect(validateConfig(cfg)).toHaveLength(0);
  });
});
