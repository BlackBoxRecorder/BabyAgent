/**
 * @timetickme/bash-tool - Lightweight, pluggable bash command execution tool
 *
 * This package provides a bash tool for executing commands with support for:
 * - Timeout control
 * - Cancellation via AbortSignal
 * - Streaming output updates
 * - Output truncation and full output saving
 * - Pluggable execution backends
 *
 * @example
 * ```typescript
 * import { createBashTool } from "@timetickme/bash-tool";
 *
 * const bashTool = createBashTool("/path/to/project");
 * const result = await bashTool({ command: "ls -la" });
 * console.log(result.content[0].text);
 * ```
 */

// Core types
export type {
  BashOperationOutput,
  BashDetails,
  BashOptions,
  BashParams,
  BashOperations,
  BashSpawnContext,
  BashSpawnHook,
  BashToolOptions,
  BashToolFunction,
  ContentItem,
  TruncationResult,
} from "./types.js";

// Main tool function
export { createBashTool, createSimpleBashTool } from "./bash.js";

// Operations
export { createLocalBashOperations } from "./operations/local.js";
export {
  createMockBashOperations,
  createCustomMockBashOperations,
} from "./operations/mock.js";

// Utilities
export {
  OutputAccumulator,
  DEFAULT_MAX_LINES,
  DEFAULT_MAX_BYTES,
} from "./utils/output.js";
export {
  getShellConfig,
  getShellEnv,
  sanitizeBinaryOutput,
  stripAnsi,
  formatSize,
} from "./utils/shell.js";
export {
  waitForChildProcess,
  killProcessTree,
  isProcessRunning,
} from "./utils/process.js";

// Tool interface adapter
export { createBashToolAsTool } from "./tool.js";
