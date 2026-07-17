#!/usr/bin/env node
/**
 * babyAgent CLI — terminal AI agent entry point.
 *
 * Usage:
 *   pnpm start
 *
 * Configuration is read from ~/.babyAgent/models.json.
 * See the Model Config section in CONTEXT.md for format details.
 */
import { createApp } from "./app.js";
import { TuiLoop } from "./tui/tui-loop.js";

// ============================================================================
// Main
// ============================================================================

const {
  coordinator,
  mcpManager,
  skillManager,
  tools,
  mcpStatuses,
  commandHandler,
} = await createApp();

const loop = new TuiLoop(
  coordinator,
  skillManager,
  tools,
  mcpStatuses,
  mcpManager,
  commandHandler,
);
loop.start();
