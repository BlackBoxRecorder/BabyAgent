import { createBashTool } from "../../src/tools/bash/index.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Playground directory path - all operations constrained here */
export const PLAYGROUND_DIR = path.join(__dirname, "playground");

// Ensure playground directory exists before tests run
mkdirSync(PLAYGROUND_DIR, { recursive: true });

/** Run command result */
export interface RunResult {
  /** Command output text */
  output: string;
  /** Exit code (null if killed) */
  exitCode: number | null;
  /** Whether command threw an error */
  error?: boolean;
}

/** Create bashTool pointing to playground directory */
export function createPlaygroundBashTool() {
  return createBashTool(PLAYGROUND_DIR);
}

/** Run command and return result */
export async function run(command: string, label?: string): Promise<RunResult> {
  const bashTool = createPlaygroundBashTool();
  const tag = label ? `[${label}]` : "";
  console.log(`\n${tag} $ ${command}`);
  console.log("─".repeat(40));

  try {
    const result = await bashTool({ command });
    const output = result.content[0].text;
    const exitCode = result.details?.exitCode ?? 0;
    console.log(output);
    console.log(`✓ exit code: ${exitCode}`);
    return { output, exitCode };
  } catch (err: any) {
    console.error(err.message);
    console.log("✗ command failed (see output above)");
    return { output: err.message, exitCode: 1, error: true };
  }
}
