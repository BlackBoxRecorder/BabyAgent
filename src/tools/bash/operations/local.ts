/**
 * Local shell execution backend for the bash tool.
 *
 * This module provides a local shell execution implementation that
 * spawns child processes to execute bash commands.
 */

import { constants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { BashOperations } from "../types.js";

/** Options for creating local bash operations */
export interface LocalBashOptions {
  /** Explicit shell path (default: /bin/bash or /bin/sh) */
  shellPath?: string;
  /** Shell arguments (default: ['-c']) */
  shellArgs?: string[];
}

/**
 * Create bash operations using local shell execution.
 *
 * This is the default implementation that spawns child processes
 * to execute bash commands on the local system.
 */
export function createLocalBashOperations(
  options?: LocalBashOptions,
): BashOperations {
  const shellPath = options?.shellPath ?? "/bin/bash";
  const shellArgs = options?.shellArgs ?? ["-c"];

  return {
    exec: async (command, cwd, { onData, signal, timeout, env }) => {
      // Check if working directory exists
      try {
        await fsAccess(cwd, constants.F_OK);
      } catch {
        throw new Error(
          `Working directory does not exist: ${cwd}\nCannot execute bash commands.`,
        );
      }

      // Check if already aborted
      if (signal?.aborted) {
        throw new Error("aborted");
      }

      // Spawn child process
      const child = spawn(shellPath, [...shellArgs, command], {
        cwd,
        detached: process.platform !== "win32",
        env: env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      // Track detached child PID for cleanup
      if (child.pid) {
        // Note: In a real implementation, you would track this for cleanup
        // For simplicity, we're not implementing process tree tracking here
      }

      let timedOut = false;
      let timeoutHandle: NodeJS.Timeout | undefined;

      // Set up timeout
      if (timeout !== undefined && timeout > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGTERM");
            } catch {
              // Process may have already exited
            }
          }
        }, timeout * 1000);
      }

      // Stream stdout and stderr
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);

      // Handle abort signal
      const onAbort = () => {
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
            // Process may have already exited
          }
        }
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      try {
        // Wait for process to complete
        const exitCode = await new Promise<number | null>((resolve, reject) => {
          child.on("error", (error) => {
            reject(new Error(`Failed to spawn process: ${error.message}`));
          });

          child.on("close", (code) => {
            resolve(code);
          });
        });

        // Check for abort
        if (signal?.aborted) {
          throw new Error("aborted");
        }

        // Check for timeout
        if (timedOut) {
          throw new Error(`timeout:${timeout}`);
        }

        return { exitCode };
      } finally {
        // Cleanup
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
      }
    },
  };
}
