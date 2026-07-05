/**
 * Unit tests for stdio.ts — parameter validation.
 */
import { describe, it, expect } from "vitest";
import { createStdioTransport } from "../../../src/mcp/transports/stdio.js";

describe("createStdioTransport", () => {
  it("throws when command is missing", async () => {
    await expect(createStdioTransport({} as any)).rejects.toThrow(
      "requires a 'command'",
    );
  });

  it("throws when command is an empty string", async () => {
    await expect(createStdioTransport({ command: "" } as any)).rejects.toThrow(
      "requires a 'command'",
    );
  });
});
