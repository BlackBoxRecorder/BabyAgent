/**
 * Bash tool implementation.
 *
 * This module provides the core bash tool implementation that
 * executes bash commands and returns the output.
 */

import type {
  BashDetails,
  BashOptions,
  BashParams,
  BashOperationOutput,
  BashSpawnContext,
  BashSpawnHook,
  BashToolFunction,
  BashToolOptions,
} from "./types.js";
import { createLocalBashOperations } from "./operations/local.js";
import { OutputAccumulator } from "./utils/output.js";
import { formatSize } from "./utils/shell.js";
import { sanitizeBinaryOutput, stripAnsi } from "./utils/shell.js";

/** Default throttle interval for output updates in milliseconds */
const DEFAULT_UPDATE_THROTTLE_MS = 100;

/**
 * Create a bash tool function.
 *
 * This function creates a bash tool that can execute commands
 * and return the output.
 *
 * @param cwd The working directory for command execution
 * @param options Options for the bash tool
 * @returns A bash tool function
 */
export function createBashTool(
  cwd: string,
  options?: BashToolOptions,
): BashToolFunction {
  const ops =
    options?.operations ??
    createLocalBashOperations({ shellPath: options?.shellPath });
  const commandPrefix = options?.commandPrefix;
  const spawnHook = options?.spawnHook;

  /**
   * Resolve the spawn context for a command.
   */
  function resolveSpawnContext(
    command: string,
    hook?: BashSpawnHook,
  ): BashSpawnContext {
    const baseContext: BashSpawnContext = {
      command,
      cwd,
      env: { ...process.env },
    };
    return hook ? hook(baseContext) : baseContext;
  }

  /**
   * Execute a bash command.
   *
   * @param params The command parameters
   * @param options Execution options
   * @returns The command result
   */
  return async function executeBash(
    params: BashParams,
    options?: BashOptions,
  ): Promise<BashOperationOutput> {
    const { command, timeout } = params;
    const signal = options?.signal;
    const onUpdate = options?.onUpdate;

    // Apply command prefix if specified
    const resolvedCommand = commandPrefix
      ? `${commandPrefix}\n${command}`
      : command;

    // Resolve spawn context
    const spawnContext = resolveSpawnContext(resolvedCommand, spawnHook);

    // Create output accumulator
    const output = new OutputAccumulator({ tempFilePrefix: "bash-output" });
    let acceptingOutput = true;
    let updateTimer: NodeJS.Timeout | undefined;
    let updateDirty = false;
    let lastUpdateAt = 0;

    /**
     * Emit an output update to the callback.
     */
    const emitOutputUpdate = () => {
      if (!onUpdate || !updateDirty) return;
      updateDirty = false;
      lastUpdateAt = Date.now();

      const snapshot = output.snapshot({ persistIfTruncated: true });
      onUpdate({
        content: [{ type: "text", text: snapshot.content || "" }],
        details: {
          exitCode: null,
          truncated: snapshot.truncation.truncated,
          fullOutputPath: snapshot.fullOutputPath,
        },
      });
    };

    /**
     * Clear the update timer.
     */
    const clearUpdateTimer = () => {
      if (updateTimer) {
        clearTimeout(updateTimer);
        updateTimer = undefined;
      }
    };

    /**
     * Schedule an output update with throttling.
     */
    const scheduleOutputUpdate = () => {
      if (!onUpdate) return;
      updateDirty = true;

      const delay = DEFAULT_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
      if (delay <= 0) {
        clearUpdateTimer();
        emitOutputUpdate();
        return;
      }

      updateTimer ??= setTimeout(() => {
        updateTimer = undefined;
        emitOutputUpdate();
      }, delay);
    };

    /**
     * Handle output data from the command.
     */
    const handleData = (data: Buffer) => {
      if (!acceptingOutput) return;

      // Sanitize the output
      const text = sanitizeBinaryOutput(stripAnsi(data.toString("utf-8")));
      output.append(text);
      scheduleOutputUpdate();
    };

    /**
     * Finish collecting output and get the final snapshot.
     */
    const finishOutput = async () => {
      acceptingOutput = false;
      output.finish();
      clearUpdateTimer();
      emitOutputUpdate();

      const snapshot = output.snapshot({ persistIfTruncated: true });
      await output.closeTempFile();
      return snapshot;
    };

    /**
     * Format the output for display.
     */
    const formatOutput = (
      snapshot: Awaited<ReturnType<typeof finishOutput>>,
      emptyText = "(no output)",
    ) => {
      const truncation = snapshot.truncation;
      let text = snapshot.content || emptyText;
      let details: BashDetails | undefined;

      if (truncation.truncated) {
        details = {
          exitCode: null,
          truncated: true,
          fullOutputPath: snapshot.fullOutputPath,
        };

        const startLine = truncation.totalLines - truncation.outputLines + 1;
        const endLine = truncation.totalLines;

        if (truncation.truncatedBy === "lines") {
          text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
        } else {
          text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(truncation.maxBytes ?? 0)} limit). Full output: ${snapshot.fullOutputPath}]`;
        }
      }

      return { text, details };
    };

    /**
     * Append a status message to the output.
     */
    const appendStatus = (text: string, status: string) => {
      return `${text ? `${text}\n\n` : ""}${status}`;
    };

    // Send initial update
    if (onUpdate) {
      onUpdate({ content: [], details: { exitCode: null } });
    }

    try {
      let exitCode: number | null;

      try {
        // Execute the command
        const result = await ops.exec(spawnContext.command, spawnContext.cwd, {
          onData: handleData,
          signal,
          timeout,
          env: spawnContext.env,
        });
        exitCode = result.exitCode;
      } catch (err) {
        // Handle errors
        const snapshot = await finishOutput();
        const { text } = formatOutput(snapshot, "");

        if (err instanceof Error && err.message === "aborted") {
          throw new Error(appendStatus(text, "Command aborted"));
        }
        if (err instanceof Error && err.message.startsWith("timeout:")) {
          const timeoutSecs = err.message.split(":")[1];
          throw new Error(
            appendStatus(
              text,
              `Command timed out after ${timeoutSecs} seconds`,
            ),
          );
        }
        throw err;
      }

      // Get final output
      const snapshot = await finishOutput();
      const { text: outputText, details } = formatOutput(snapshot);

      // Check exit code
      if (exitCode !== 0 && exitCode !== null) {
        throw new Error(
          appendStatus(outputText, `Command exited with code ${exitCode}`),
        );
      }

      return {
        content: [{ type: "text", text: outputText }],
        details: details ?? { exitCode },
      };
    } finally {
      clearUpdateTimer();
    }
  };
}

/**
 * Create a bash tool function with default options.
 *
 * This is a convenience function for creating a bash tool
 * with sensible defaults.
 *
 * @param cwd The working directory for command execution
 * @returns A bash tool function
 */
export function createSimpleBashTool(cwd: string): BashToolFunction {
  return createBashTool(cwd);
}
