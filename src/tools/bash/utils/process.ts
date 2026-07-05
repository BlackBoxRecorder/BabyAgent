/**
 * Process utility functions for the bash tool.
 *
 * This module provides utility functions for process management
 * such as waiting for child processes and killing process trees.
 */

import { type ChildProcess } from "node:child_process";

/**
 * Wait for a child process to complete.
 *
 * This function properly handles process completion without hanging
 * on inherited stdio handles held by detached descendants.
 *
 * @param child The child process to wait for
 * @returns Promise that resolves with the exit code
 */
export function waitForChildProcess(
  child: ChildProcess,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    child.on("error", (error) => {
      settle(() => reject(new Error(`Process error: ${error.message}`)));
    });

    child.on("close", (code) => {
      settle(() => resolve(code));
    });

    // Handle case where process exits immediately
    if (child.exitCode !== null) {
      settle(() => resolve(child.exitCode));
    }
  });
}

/**
 * Kill a process tree.
 *
 * This function kills a process and all its children.
 *
 * @param pid The process ID to kill
 * @param signal The signal to send (default: SIGTERM)
 */
export function killProcessTree(
  pid: number,
  signal: NodeJS.Signals = "SIGTERM",
): void {
  try {
    // On Windows, use taskkill to kill the process tree
    if (process.platform === "win32") {
      try {
        const { execSync } = require("child_process");
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
      } catch {
        // Ignore errors
      }
      return;
    }

    // On Unix-like systems, kill the process group
    try {
      process.kill(-pid, signal);
    } catch {
      // Process may have already exited
    }

    // Also try to kill the process directly
    try {
      process.kill(pid, signal);
    } catch {
      // Process may have already exited
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Check if a process is still running.
 *
 * @param pid The process ID to check
 * @returns True if the process is running
 */
export function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
