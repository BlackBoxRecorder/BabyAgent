/**
 * Unit tests for tool-adapter.ts — Schema conversion, content extraction, tool adaptation.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeSchema,
  extractTextContent,
  adaptMcpTool,
} from "../../src/mcp/tool-adapter.js";
import type { JsonSchema } from "../../src/tools/interface/index.js";
import type {
  McpTransport,
  McpToolDef,
  McpCallToolResult,
} from "../../src/mcp/transports/types.js";

/** Create a minimal mock transport for testing adaptMcpTool. */
function mockTransport(
  callToolImpl?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<McpCallToolResult>,
): McpTransport {
  return {
    client: {} as any,
    close: async () => {},
    listTools: async () => [],
    callTool:
      callToolImpl ??
      (async () => ({ content: [], isError: false }) as McpCallToolResult),
  };
}

describe("normalizeSchema", () => {
  it("normalizes a simple schema with no properties", () => {
    const input: JsonSchema = { type: "object" };
    const result = normalizeSchema(input);
    expect(result.type).toBe("object");
    expect(result.properties).toEqual({});
  });

  it("preserves schema properties as-is (no deep copy needed)", () => {
    const input: JsonSchema = {
      type: "object",
      properties: {
        name: { type: "string", description: "The name" },
      },
      required: ["name"],
    };
    const result = normalizeSchema(input);
    expect(result.type).toBe("object");
    expect(result.properties?.name).toEqual({
      type: "string",
      description: "The name",
    });
    expect(result.required).toEqual(["name"]);
  });

  it("preserves enum on properties", () => {
    const input: JsonSchema = {
      type: "object",
      properties: {
        color: { type: "string", enum: ["red", "green", "blue"] },
      },
    };
    const result = normalizeSchema(input);
    expect(result.properties?.color.enum).toEqual(["red", "green", "blue"]);
  });

  it("returns empty properties when missing", () => {
    const input: JsonSchema = { type: "object" };
    const result = normalizeSchema(input);
    expect(result.properties).toEqual({});
  });

  it("preserves nested object properties", () => {
    const input: JsonSchema = {
      type: "object",
      properties: {
        config: {
          type: "object",
          properties: {
            debug: { type: "boolean" },
          },
        },
      },
    };
    const result = normalizeSchema(input);
    const configProp = result.properties?.config;
    expect(configProp?.type).toBe("object");
    expect(configProp?.properties?.debug.type).toBe("boolean");
  });

  it("preserves array items", () => {
    const input: JsonSchema = {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
        },
      },
    };
    const result = normalizeSchema(input);
    expect(result.properties?.tags.type).toBe("array");
    expect(result.properties?.tags.items?.type).toBe("string");
  });

  it("preserves additionalProperties flag", () => {
    const input: JsonSchema = {
      type: "object",
      additionalProperties: false,
    };
    const result = normalizeSchema(input);
    expect(result.additionalProperties).toBe(false);
  });

  it("handles null / undefined input safely", () => {
    const result = normalizeSchema(null as unknown as JsonSchema);
    expect(result.type).toBe("object");
    expect(result.properties).toEqual({});
  });
});

describe("extractTextContent", () => {
  it("returns empty string for empty array", () => {
    expect(extractTextContent([])).toBe("");
  });

  it("extracts text content", () => {
    const content = [{ type: "text" as const, text: "Hello world" }];
    expect(extractTextContent(content)).toBe("Hello world");
  });

  it("joins multiple text items", () => {
    const content = [
      { type: "text" as const, text: "Line 1" },
      { type: "text" as const, text: "Line 2" },
    ];
    expect(extractTextContent(content)).toBe("Line 1\nLine 2");
  });

  it("creates placeholder for image content", () => {
    const content = [
      { type: "image" as const, data: "base64...", mimeType: "image/png" },
    ];
    expect(extractTextContent(content)).toBe("[Image: image/png]");
  });

  it("creates placeholder for audio content", () => {
    const content = [
      { type: "audio" as const, data: "base64...", mimeType: "audio/mp3" },
    ];
    expect(extractTextContent(content)).toBe("[Audio: audio/mp3]");
  });

  it("extracts text from resource with text field", () => {
    const content = [
      {
        type: "resource" as const,
        resource: { uri: "file:///test.txt", text: "File content" },
      },
    ];
    expect(extractTextContent(content)).toBe("File content");
  });

  it("creates placeholder for resource without text", () => {
    const content = [
      {
        type: "resource" as const,
        resource: { uri: "file:///image.png" },
      },
    ];
    expect(extractTextContent(content)).toBe("[Resource: file:///image.png]");
  });

  it("creates placeholder for resource_link", () => {
    const content = [
      {
        type: "resource_link" as const,
        uri: "file:///doc.pdf",
        name: "Document",
      },
    ];
    expect(extractTextContent(content)).toBe(
      "[Resource: file:///doc.pdf (Document)]",
    );
  });

  it("handles mixed content types", () => {
    const content = [
      { type: "text" as const, text: "Result:" },
      { type: "image" as const, data: "...", mimeType: "image/jpeg" },
      { type: "text" as const, text: "Done." },
    ];
    expect(extractTextContent(content)).toBe(
      "Result:\n[Image: image/jpeg]\nDone.",
    );
  });
});

describe("adaptMcpTool", () => {
  const baseDef: McpToolDef = {
    name: "hello",
    description: "Say hello",
    inputSchema: { type: "object", properties: {} },
  };

  it("prepends server name to tool name", () => {
    const tool = adaptMcpTool("my-server", baseDef, mockTransport());
    expect(tool.name).toBe("my-server_hello");
  });

  it("falls back to a default description when none provided", () => {
    const def: McpToolDef = {
      name: "no-desc",
      inputSchema: { type: "object" },
    };
    const tool = adaptMcpTool("srv", def, mockTransport());
    expect(tool.description).toContain("srv");
  });

  it("returns success result on normal tool call", async () => {
    const t = mockTransport(
      async () =>
        ({
          content: [{ type: "text", text: "Hello world" }],
          isError: false,
        }) as McpCallToolResult,
    );
    const tool = adaptMcpTool("srv", baseDef, t);
    const result = await tool.execute({});
    expect(result.success).toBe(true);
    expect(result.output).toBe("Hello world");
  });

  it("returns failure result when MCP tool signals isError", async () => {
    const t = mockTransport(
      async () =>
        ({
          content: [{ type: "text", text: "Something went wrong" }],
          isError: true,
        }) as McpCallToolResult,
    );
    const tool = adaptMcpTool("srv", baseDef, t);
    const result = await tool.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toBe("Something went wrong");
  });

  it("returns failure result when transport throws", async () => {
    const t = mockTransport(async () => {
      throw new Error("Network error");
    });
    const tool = adaptMcpTool("srv", baseDef, t);
    const result = await tool.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toBe("Network error");
  });

  it("passes parameters through to the transport", async () => {
    let receivedArgs: Record<string, unknown> | undefined;
    const t = mockTransport(async (name, args) => {
      receivedArgs = args;
      return { content: [], isError: false } as McpCallToolResult;
    });
    const tool = adaptMcpTool("srv", baseDef, t);
    await tool.execute({ key: "value", num: 42 });
    expect(receivedArgs).toEqual({ key: "value", num: 42 });
  });
});
