#!/usr/bin/env node
/**
 * babyAgent CLI — terminal AI agent entry point.
 *
 * Usage:
 *   DEEPSEEK_API_KEY="your-key" node dist/cli.js
 * or:
 *   pnpm start
 */
import { createApp } from "./cli/app-factory.js";
import { TuiLoop } from "./cli/tui-loop.js";

// ============================================================================
// Configuration
// ============================================================================

const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) {
  console.error("Error: DEEPSEEK_API_KEY environment variable is required.");
  console.error("Usage: DEEPSEEK_API_KEY='your-key' pnpm start");
  process.exit(1);
}

// ============================================================================
// Main
// ============================================================================

const { coordinator, commandRouter, mcpManager } = await createApp();

const loop = new TuiLoop(coordinator, commandRouter, mcpManager);
loop.start();
