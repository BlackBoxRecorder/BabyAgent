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
import { createApp } from "./cli/app-factory.js";
import { TuiLoop } from "./cli/tui-loop.js";

// ============================================================================
// Main
// ============================================================================

const { coordinator, commandRouter, mcpManager, models, defaultModelId } =
  await createApp();

const loop = new TuiLoop(
  coordinator,
  commandRouter,
  mcpManager,
  models,
  defaultModelId,
);
loop.start();
