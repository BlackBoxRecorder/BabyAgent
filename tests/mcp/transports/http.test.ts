/**
 * Unit tests for http.ts — parameter validation.
 */
import { describe, it, expect } from "vitest";
import { createHttpTransport } from "../../../src/mcp/transports/http.js";

describe("createHttpTransport", () => {
  it("throws when url is missing", async () => {
    await expect(createHttpTransport({} as any)).rejects.toThrow(
      "requires a 'url'",
    );
  });

  it("throws when url is an empty string", async () => {
    await expect(createHttpTransport({ url: "" } as any)).rejects.toThrow(
      "requires a 'url'",
    );
  });
});
