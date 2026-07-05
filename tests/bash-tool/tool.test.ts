/**
 * Tests for the bash tool implementation (createBashTool, createSimpleBashTool).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createBashTool,
  createSimpleBashTool,
} from "../../src/tools/bash/bash.js";
import { createMockBashOperations } from "../../src/tools/bash/operations/mock.js";

describe("Bash Tool", () => {
  const cwd = "/test";
  let mockOps: ReturnType<typeof createMockBashOperations>;

  beforeEach(() => {
    mockOps = createMockBashOperations();
  });

  describe("createBashTool", () => {
    it("should execute a command successfully", async () => {
      const bashTool = createBashTool(cwd, { operations: mockOps });
      const result = await bashTool({ command: "echo hello" });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("Mock execution of: echo hello");
      expect(result.details?.exitCode).toBe(0);
    });

    it("should handle command with timeout", async () => {
      const bashTool = createBashTool(cwd, { operations: mockOps });
      const result = await bashTool({ command: "echo hello", timeout: 5 });

      expect(result.content).toHaveLength(1);
      expect(result.details?.exitCode).toBe(0);
    });

    it("should call onUpdate callback", async () => {
      const onUpdate = vi.fn();
      const bashTool = createBashTool(cwd, { operations: mockOps });

      await bashTool({ command: "echo hello" }, { onUpdate });

      // Should have been called at least once (initial + final)
      expect(onUpdate).toHaveBeenCalled();
    });

    it("should handle abort signal", async () => {
      const controller = new AbortController();
      const bashTool = createBashTool(cwd, { operations: mockOps });

      // Abort immediately
      controller.abort();

      await expect(
        bashTool({ command: "echo hello" }, { signal: controller.signal }),
      ).rejects.toThrow("aborted");
    });
  });

  describe("createSimpleBashTool", () => {
    it("should create a simple bash tool", async () => {
      const bashTool = createSimpleBashTool(cwd);
      // Note: This will use the actual local operations
      // In a real test, you would mock the operations
      expect(bashTool).toBeDefined();
    });
  });
});

describe("Mock Operations", () => {
  it("should return default output", async () => {
    const ops = createMockBashOperations();
    let output = "";

    await ops.exec("test command", "/test", {
      onData: (data) => {
        output += data.toString();
      },
    });

    expect(output).toContain("Mock execution of: test command");
  });

  it("should return custom output", async () => {
    const ops = createMockBashOperations({
      defaultOutput: "custom output",
    });
    let output = "";

    await ops.exec("test command", "/test", {
      onData: (data) => {
        output += data.toString();
      },
    });

    expect(output).toBe("custom output");
  });

  it("should simulate delay", async () => {
    const ops = createMockBashOperations({
      delay: 100,
    });
    const start = Date.now();

    await ops.exec("test command", "/test", {
      onData: () => {},
    });

    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some tolerance
  });

  it("should simulate error", async () => {
    const ops = createMockBashOperations({
      shouldError: true,
    });

    await expect(
      ops.exec("test command", "/test", {
        onData: () => {},
      }),
    ).rejects.toThrow("Mock error");
  });
});
