/// <reference types="node" />

/**
 * Shared utilities for LLM verification scripts.
 */
import { ChatClient } from "../src/llm/index.js";
import {
  loadModelConfig,
  getAllModels,
  type ModelEntry,
} from "../src/llm/models.js";

// ── Client ──────────────────────────────────────────────

/** Create a DeepSeekClient with defaults from env. */
export async function createClient(): Promise<ChatClient> {
  const modelConfig = await loadModelConfig();
  const allModels = getAllModels(modelConfig);
  return new ChatClient(allModels);
}

// ── Formatting ──────────────────────────────────────────

const WIDTH = 56;

/** Print a labeled section header. */
export function printSection(title: string): void {
  const pad = Math.max(0, WIDTH - title.length - 2);
  const left = "─".repeat(Math.floor(pad / 2));
  const right = "─".repeat(Math.ceil(pad / 2));
  console.log(`\n${left} ${title} ${right}`);
}

/** Print a key-value line. */
export function printKV(key: string, value: unknown): void {
  const val = typeof value === "string" ? value : JSON.stringify(value);
  console.log(`${key}: ${val}`);
}

/** Pretty-print an object as JSON. */
export function printJSON(label: string, obj: unknown): void {
  console.log(`${label}:`);
  console.log(JSON.stringify(obj, null, 2));
}

/** Print elapsed time from a start timestamp. */
export function printElapsed(startMs: number): void {
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(2);
  printKV("耗时", `${elapsed}s`);
}
