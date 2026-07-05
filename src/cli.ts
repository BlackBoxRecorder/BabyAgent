#!/usr/bin/env node
/**
 * deepCode CLI — terminal AI agent entry point.
 *
 * Usage:
 *   DEEPSEEK_API_KEY="your-key" node dist/cli.js
 * or:
 *   pnpm start
 */
import { createApp } from "./cli/app-factory.js";
import { AppLoop } from "./cli/app-loop.js";

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

const { coordinator, commandRouter, display, mcpManager } = await createApp();

const loop = new AppLoop(coordinator, commandRouter, display, mcpManager);
loop.start();
