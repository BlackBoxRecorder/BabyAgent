/**
 * Operations interface for the bash tool.
 *
 * This module defines the pluggable operations interface that allows
 * the bash tool to delegate command execution to different backends.
 */

export type { BashOperations } from "../types.js";

export { createLocalBashOperations } from "./local.js";
export { createMockBashOperations } from "./mock.js";
