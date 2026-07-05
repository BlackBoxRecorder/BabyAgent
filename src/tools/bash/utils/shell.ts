/**
 * Shell utility functions for the bash tool.
 *
 * This module provides utility functions for shell operations
 * such as getting shell configuration and environment variables.
 */

/** Shell configuration */
export interface ShellConfig {
  /** Path to the shell executable */
  shell: string;
  /** Arguments to pass to the shell */
  args: string[];
  /** How commands are transported to the shell */
  commandTransport: "args" | "stdin";
}

/**
 * Get shell configuration based on the platform and provided shell path.
 *
 * @param shellPath Optional explicit shell path
 * @returns Shell configuration
 */
export function getShellConfig(shellPath?: string): ShellConfig {
  // Default shell based on platform
  const defaultShell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
  const shell = shellPath ?? defaultShell;

  // Configure shell arguments based on the shell type
  if (process.platform === "win32") {
    return {
      shell,
      args: ["/c"],
      commandTransport: "args",
    };
  }

  // For bash/zsh/sh, use -c to execute commands
  return {
    shell,
    args: ["-c"],
    commandTransport: "args",
  };
}

/**
 * Get environment variables for shell execution.
 *
 * @param env Optional additional environment variables
 * @returns Environment variables
 */
export function getShellEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...env,
    // Ensure PATH is always set
    PATH: env?.PATH ?? process.env.PATH,
  };
}

/**
 * Sanitize binary output by replacing non-printable characters.
 *
 * @param text The text to sanitize
 * @returns Sanitized text
 */
export function sanitizeBinaryOutput(text: string): string {
  // Replace null bytes and other control characters
  return text
    .replace(/\0/g, "") // Remove null bytes
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // Remove control characters except newline and carriage return
    .replace(/\r\n/g, "\n") // Normalize line endings
    .replace(/\r/g, "\n"); // Convert remaining carriage returns to newlines
}

/**
 * Strip ANSI escape codes from text.
 *
 * @param text The text to process
 * @returns Text without ANSI codes
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * Format a size in bytes to a human-readable string.
 *
 * @param bytes The size in bytes
 * @returns Formatted string (e.g., "1.5 KB", "2.3 MB")
 */
export function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}
