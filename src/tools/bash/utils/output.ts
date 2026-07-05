/**
 * Output utility functions for the bash tool.
 *
 * This module provides utility functions for handling command output
 * such as accumulation, truncation, and formatting.
 */

import { randomBytes } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TruncationResult } from "../types.js";

/** Default maximum number of lines to keep in output */
export const DEFAULT_MAX_LINES = 1000;

/** Default maximum number of bytes to keep in output */
export const DEFAULT_MAX_BYTES = 1024 * 1024; // 1MB

/** Options for the output accumulator */
export interface OutputAccumulatorOptions {
  /** Prefix for temporary files */
  tempFilePrefix?: string;
  /** Maximum number of lines to keep */
  maxLines?: number;
  /** Maximum number of bytes to keep */
  maxBytes?: number;
}

/**
 * Output accumulator for handling command output.
 *
 * This class accumulates output data and handles truncation
 * when the output exceeds specified limits.
 */
export class OutputAccumulator {
  private chunks: string[] = [];
  private totalBytes = 0;
  private totalLines = 0;
  private tempFilePath: string | undefined;
  private tempFileStream: WriteStream | undefined;
  private finished = false;

  private readonly maxLines: number;
  private readonly maxBytes: number;
  private readonly tempFilePrefix: string;

  constructor(options?: OutputAccumulatorOptions) {
    this.maxLines = options?.maxLines ?? DEFAULT_MAX_LINES;
    this.maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
    this.tempFilePrefix = options?.tempFilePrefix ?? "bash-output";
  }

  /**
   * Append data to the accumulator.
   *
   * @param data The data to append
   */
  append(data: Buffer | string): void {
    if (this.finished) {
      return;
    }

    const text = typeof data === "string" ? data : data.toString("utf-8");
    const lines = text.split("\n");

    for (const line of lines) {
      this.chunks.push(line + "\n");
      this.totalBytes += Buffer.byteLength(line + "\n", "utf-8");
      this.totalLines++;
    }

    // Trim if we exceed limits
    this.trim();
  }

  /**
   * Mark the accumulator as finished.
   */
  finish(): void {
    this.finished = true;
  }

  /**
   * Get a snapshot of the current output.
   *
   * @param options Options for the snapshot
   * @returns The output snapshot
   */
  snapshot(options?: { persistIfTruncated?: boolean }): {
    content: string;
    truncation: TruncationResult;
    fullOutputPath?: string;
  } {
    const content = this.chunks.join("");
    const truncated =
      this.totalLines > this.maxLines || this.totalBytes > this.maxBytes;

    let truncation: TruncationResult;

    if (truncated) {
      // Calculate how many lines/bytes we're showing
      let outputLines = 0;
      let outputBytes = 0;
      const maxBytes = this.maxBytes;

      // Count from the end to get the last N lines/bytes
      for (let i = this.chunks.length - 1; i >= 0; i--) {
        const chunkBytes = Buffer.byteLength(this.chunks[i], "utf-8");

        if (
          outputLines >= this.maxLines ||
          outputBytes + chunkBytes > maxBytes
        ) {
          break;
        }

        outputLines++;
        outputBytes += chunkBytes;
      }

      truncation = {
        truncated: true,
        truncatedBy: outputLines >= this.maxLines ? "lines" : "bytes",
        outputLines,
        totalLines: this.totalLines,
        outputBytes,
        maxBytes: this.maxBytes,
        maxLines: this.maxLines,
      };
    } else {
      truncation = {
        truncated: false,
        outputLines: this.totalLines,
        totalLines: this.totalLines,
        outputBytes: this.totalBytes,
      };
    }

    // Create temp file if needed
    let fullOutputPath: string | undefined;
    if (truncated && options?.persistIfTruncated) {
      fullOutputPath = this.createTempFile(content);
    }

    return {
      content,
      truncation,
      fullOutputPath,
    };
  }

  /**
   * Close the temporary file if it was created.
   */
  async closeTempFile(): Promise<void> {
    if (this.tempFileStream) {
      return new Promise((resolve) => {
        this.tempFileStream!.end(() => {
          this.tempFileStream = undefined;
          resolve();
        });
      });
    }
  }

  /**
   * Get the number of bytes in the last line.
   */
  getLastLineBytes(): number {
    if (this.chunks.length === 0) return 0;
    return Buffer.byteLength(this.chunks[this.chunks.length - 1], "utf-8");
  }

  /**
   * Trim the output to stay within limits.
   */
  private trim(): void {
    // Trim by lines
    while (this.chunks.length > this.maxLines * 2) {
      const removed = this.chunks.shift()!;
      this.totalBytes -= Buffer.byteLength(removed, "utf-8");
      this.totalLines--;
    }

    // Trim by bytes
    while (this.totalBytes > this.maxBytes * 2 && this.chunks.length > 1) {
      const removed = this.chunks.shift()!;
      this.totalBytes -= Buffer.byteLength(removed, "utf-8");
      this.totalLines--;
    }
  }

  /**
   * Create a temporary file with the full output.
   */
  private createTempFile(_content: string): string {
    if (this.tempFilePath) {
      return this.tempFilePath;
    }

    const id = randomBytes(8).toString("hex");
    this.tempFilePath = join(tmpdir(), `${this.tempFilePrefix}-${id}.log`);
    this.tempFileStream = createWriteStream(this.tempFilePath);

    // Write all chunks to the temp file
    for (const chunk of this.chunks) {
      this.tempFileStream.write(chunk);
    }

    return this.tempFilePath;
  }
}

/**
 * Truncate text to a maximum number of lines.
 *
 * @param text The text to truncate
 * @param maxLines Maximum number of lines
 * @returns The truncated text
 */
export function truncateLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) {
    return text;
  }
  return lines.slice(-maxLines).join("\n");
}

/**
 * Truncate text to a maximum number of bytes.
 *
 * @param text The text to truncate
 * @param maxBytes Maximum number of bytes
 * @returns The truncated text
 */
export function truncateBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf-8") <= maxBytes) {
    return text;
  }

  // Truncate from the beginning to keep the end
  const buffer = Buffer.from(text, "utf-8");
  const truncated = buffer.subarray(buffer.length - maxBytes);
  return truncated.toString("utf-8");
}
