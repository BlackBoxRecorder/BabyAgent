/**
 * System prompt loader — reads ~/.babyAgent/system_prompt.md,
 * creates default if missing. Fail fast on read errors.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { getLogger } from "../logger.js";

// ============================================================================
// Constants
// ============================================================================

const CONFIG_DIR = path.join(os.homedir(), ".babyAgent");
const SYSTEM_PROMPT_PATH = path.join(CONFIG_DIR, "system_prompt.md");

const DEFAULT_SYSTEM_PROMPT = `You are a helpful terminal AI agent. You have access to bash commands and filesystem tools. When performing tasks, use tools to gather information before responding. Be concise and direct.`;

// ============================================================================
// Loader
// ============================================================================

/**
 * Load the system prompt from ~/.babyAgent/system_prompt.md.
 * Creates the file with default content if it doesn't exist.
 * Throws on read errors (fail-fast like models.json).
 */
export async function loadSystemPrompt(): Promise<string> {
  const logger = getLogger();

  try {
    // Check if file exists
    const exists = await fs
      .access(SYSTEM_PROMPT_PATH)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      logger.info("system-prompt", "creating_default", {
        path: SYSTEM_PROMPT_PATH,
      });
      await createDefaultSystemPrompt();
    }

    // Read the file
    const content = await fs.readFile(SYSTEM_PROMPT_PATH, "utf-8");

    // Trim whitespace and return
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error(`System prompt file is empty: ${SYSTEM_PROMPT_PATH}`);
    }

    logger.info("system-prompt", "loaded", {
      path: SYSTEM_PROMPT_PATH,
      length: trimmed.length,
      isNew: !exists,
    });

    return trimmed;
  } catch (err) {
    logger.error(
      "system-prompt",
      "load_failed",
      { path: SYSTEM_PROMPT_PATH },
      err instanceof Error ? err : new Error(String(err)),
    );

    if (
      err instanceof Error &&
      err.message.includes("System prompt file is empty")
    ) {
      throw err;
    }
    throw new Error(
      `Failed to read system prompt from ${SYSTEM_PROMPT_PATH}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Create the default system prompt file.
 * Creates the ~/.babyAgent directory if needed.
 */
async function createDefaultSystemPrompt(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(SYSTEM_PROMPT_PATH, DEFAULT_SYSTEM_PROMPT + "\n", "utf-8");
}

/**
 * Get the path to the system prompt file (for display purposes).
 */
export function getSystemPromptPath(): string {
  return SYSTEM_PROMPT_PATH;
}
