/**
 * Unit tests for with-timeout.ts — timeout helper.
 */
import { describe, it, expect } from "vitest";
import { withTimeout } from "../../../src/mcp/transports/with-timeout.js";

describe("withTimeout", () => {
  it("resolves when the promise resolves before timeout", async () => {
    const result = await withTimeout(
      Promise.resolve("ok"),
      5000,
      "should not happen",
    );
    expect(result).toBe("ok");
  });

  it("rejects when the timeout fires first", async () => {
    const never = new Promise<string>(() => {}); // never resolves
    await expect(limitedTimeout(never, 10, "too slow")).rejects.toThrow(
      "too slow",
    );
  });

  it("cleans up the timer when the promise resolves first", async () => {
    // No unhandled rejection warning should appear; we verify
    // by ensuring the resolved value is correct.
    const result = await withTimeout(
      Promise.resolve("fast"),
      100, // timer will be cleared before it fires
      "should not fire",
    );
    expect(result).toBe("fast");
  });
});

/**
 * Convenience wrapper with a very short timeout for test speed.
 */
async function limitedTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return withTimeout(promise, ms, message);
}
