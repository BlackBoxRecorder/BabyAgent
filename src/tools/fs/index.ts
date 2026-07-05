/**
 * Main entry point for the fs-tool package.
 * This package provides pluggable filesystem tools for AI agents.
 */

// Core module
export * from "./core/index.js";

// Adapters module
export * from "./adapters/index.js";

// Tools module
export * from "./tools/index.js";

// Tool interface adapter
export { createAllFsTools } from "./tool.js";
