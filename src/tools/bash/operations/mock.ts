/**
 * Mock execution backend for the bash tool.
 *
 * This module provides a mock implementation for testing purposes.
 * It simulates command execution without actually spawning processes.
 */

import type { BashOperations } from "../types.js";

/** Options for creating mock bash operations */
export interface MockBashOptions {
  /** Default exit code to return (default: 0) */
  defaultExitCode?: number;
  /** Default output to return */
  defaultOutput?: string;
  /** Simulate execution delay in milliseconds */
  delay?: number;
  /** Whether to simulate errors */
  shouldError?: boolean;
}

/**
 * Create mock bash operations for testing.
 *
 * This implementation simulates command execution without
 * actually spawning processes, useful for unit tests.
 */
export function createMockBashOperations(
  options?: MockBashOptions,
): BashOperations {
  const defaultExitCode = options?.defaultExitCode ?? 0;
  const defaultOutput = options?.defaultOutput ?? "";
  const delay = options?.delay ?? 0;
  const shouldError = options?.shouldError ?? false;

  return {
    exec: async (command, cwd, { onData, signal }) => {
      // Check if already aborted
      if (signal?.aborted) {
        throw new Error("aborted");
      }

      // Simulate delay if specified
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // Check for abort during delay
      if (signal?.aborted) {
        throw new Error("aborted");
      }

      // Simulate error if specified
      if (shouldError) {
        throw new Error("Mock error: Command execution failed");
      }

      // Generate mock output
      const output =
        defaultOutput ||
        `Mock execution of: ${command}\nWorking directory: ${cwd}`;

      // Send output data
      onData(Buffer.from(output));

      return { exitCode: defaultExitCode };
    },
  };
}

/**
 * Create mock bash operations with custom response handler.
 *
 * This implementation allows custom handling of commands for
 * more complex test scenarios.
 */
export function createCustomMockBashOperations(
  handler: (
    command: string,
    cwd: string,
  ) => { output: string; exitCode: number },
): BashOperations {
  return {
    exec: async (command, cwd, { onData }) => {
      const result = handler(command, cwd);
      onData(Buffer.from(result.output));
      return { exitCode: result.exitCode };
    },
  };
}
