/**
 * Core types for the bash tool.
 */

/** Content item returned by tools */
export interface ContentItem {
  type: "text";
  text: string;
}

/** Internal result returned by the bash execution engine. Not to be confused with tools/interface's ToolResult. */
export interface BashOperationOutput {
  /** Text or image content returned to the model */
  content: ContentItem[];
  /** Structured details for logs or UI rendering */
  details?: BashDetails;
  /** Hint that the agent should stop after the current tool batch */
  terminate?: boolean;
}

/** Details included in the bash result */
export interface BashDetails {
  /** Process exit code (null if killed/cancelled) */
  exitCode: number | null;
  /** Whether the output was truncated */
  truncated?: boolean;
  /** Path to temp file containing full output (if output exceeded truncation threshold) */
  fullOutputPath?: string;
  /** Whether the command was cancelled via signal */
  cancelled?: boolean;
}

/** Options for executing a bash command */
export interface BashOptions {
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Callback for streaming output updates */
  onUpdate?: (result: BashOperationOutput) => void;
}

/** Parameters for the bash tool */
export interface BashParams {
  /** Bash command to execute */
  command: string;
  /** Timeout in seconds (optional, no default timeout) */
  timeout?: number;
}

/** Pluggable operations for the bash tool */
export interface BashOperations {
  /**
   * Execute a command and stream output.
   * @param command The command to execute
   * @param cwd Working directory
   * @param options Execution options
   * @returns Promise resolving to exit code (null if killed)
   */
  exec: (
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void;
      signal?: AbortSignal;
      timeout?: number;
      env?: NodeJS.ProcessEnv;
    },
  ) => Promise<{ exitCode: number | null }>;
}

/** Context for spawning a bash command */
export interface BashSpawnContext {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/** Hook to adjust command, cwd, or env before execution */
export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

/** Options for creating a bash tool */
export interface BashToolOptions {
  /** Custom operations for command execution. Default: local shell */
  operations?: BashOperations;
  /** Command prefix prepended to every command (for example shell setup commands) */
  commandPrefix?: string;
  /** Optional explicit shell path from settings */
  shellPath?: string;
  /** Hook to adjust command, cwd, or env before execution */
  spawnHook?: BashSpawnHook;
}

/** The bash tool function type */
export type BashToolFunction = (
  params: BashParams,
  options?: BashOptions,
) => Promise<BashOperationOutput>;

/** Truncation result for output handling */
export interface TruncationResult {
  /** Whether the output was truncated */
  truncated: boolean;
  /** How the output was truncated ("lines" or "bytes") */
  truncatedBy?: "lines" | "bytes";
  /** Number of lines in the output */
  outputLines: number;
  /** Total number of lines */
  totalLines: number;
  /** Number of bytes in the output */
  outputBytes: number;
  /** Whether the last line was partially included */
  lastLinePartial?: boolean;
  /** Maximum bytes limit */
  maxBytes?: number;
  /** Maximum lines limit */
  maxLines?: number;
}
