/**
 * Core types for the fs-tool package.
 * These types are framework-agnostic and can be used in any project.
 */

import type { JsonSchema } from "../../interface/index.js";

// ============================================================================
// File Operations Interface
// ============================================================================

/**
 * Pluggable file operations interface.
 * Override these to delegate file operations to remote systems (e.g., SSH).
 */
export interface FileOperations {
  /** Read file contents as a Buffer */
  readFile: (absolutePath: string) => Promise<Buffer>;
  /** Write content to a file */
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  /** Check if file is readable (throw if not) */
  access: (absolutePath: string) => Promise<void>;
  /** Create directory recursively */
  mkdir: (dir: string) => Promise<void>;
  /** Get file or directory stats */
  stat: (absolutePath: string) => Promise<{ isDirectory: () => boolean }>;
  /** Read directory entries */
  readdir: (absolutePath: string) => Promise<string[]>;
  /** Check if path exists */
  exists: (absolutePath: string) => Promise<boolean>;
}

// ============================================================================
// Tool Result Types
// ============================================================================

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

/** Internal result type for fs-tool operations. Not to be confused with tools/interface's ToolResult. */
export interface FsOperationOutput {
  content: Array<TextContent | ImageContent>;
  details?: unknown;
}

// ============================================================================
// Tool Definition Types
// ============================================================================

export interface GenericToolDefinition<TParams = Record<string, unknown>> {
  name: string;
  label: string;
  description: string;
  parameters: TParams;
  execute(params: TParams, signal?: AbortSignal): Promise<FsOperationOutput>;
}

/**
 * Tool definition that accepts any parameters.
 * This is the main tool definition type used by adapters.
 */
export interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: JsonSchema;
  execute(
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<FsOperationOutput>;
}

// ============================================================================
// Truncation Types
// ============================================================================

export interface TruncationResult {
  /** The truncated content */
  content: string;
  /** Whether truncation occurred */
  truncated: boolean;
  /** Which limit was hit: "lines", "bytes", or null if not truncated */
  truncatedBy: "lines" | "bytes" | null;
  /** Total number of lines in the original content */
  totalLines: number;
  /** Total number of bytes in the original content */
  totalBytes: number;
  /** Number of complete lines in the truncated output */
  outputLines: number;
  /** Number of bytes in the truncated output */
  outputBytes: number;
  /** Whether the last line was partially truncated (only for tail truncation edge case) */
  lastLinePartial: boolean;
  /** Whether the first line exceeded the byte limit (for head truncation) */
  firstLineExceedsLimit: boolean;
  /** The max lines limit that was applied */
  maxLines: number;
  /** The max bytes limit that was applied */
  maxBytes: number;
}

export interface TruncationOptions {
  /** Maximum number of lines (default: 2000) */
  maxLines?: number;
  /** Maximum number of bytes (default: 50KB) */
  maxBytes?: number;
}

// ============================================================================
// Tool Input Types
// ============================================================================

export interface ReadToolInput {
  path: string;
  offset?: number;
  limit?: number;
}

export interface WriteToolInput {
  path: string;
  content: string;
}

export interface EditToolInput {
  path: string;
  edits: Array<{ oldText: string; newText: string }>;
}

export interface GrepToolInput {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  limit?: number;
}

export interface FindToolInput {
  pattern: string;
  path?: string;
  limit?: number;
}

export interface LsToolInput {
  path?: string;
  limit?: number;
}

export interface BashToolInput {
  command: string;
  timeout?: number;
}
