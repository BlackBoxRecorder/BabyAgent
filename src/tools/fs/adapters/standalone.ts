/**
 * Standalone adapter for the fs-tool package.
 * This adapter provides a simple interface for using fs-tool without any framework.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import {
  type Edit,
  applyEditsToNormalizedContent,
  detectLineEnding,
  generateDiffString,
  generateUnifiedPatch,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from "../core/edit-diff.js";
import { createLocalFileOperations } from "../core/file-operations.js";
import { resolveReadPathAsync, resolveToCwd } from "../core/path-utils.js";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  truncateLine,
} from "../core/truncate.js";
import type {
  FileOperations,
  ToolDefinition,
  FsOperationOutput,
} from "../core/types.js";

/**
 * Create a read tool.
 */
export function createReadTool(
  cwd: string,
  operations: FileOperations = createLocalFileOperations(),
): ToolDefinition {
  return {
    name: "read",
    label: "read",
    description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to read (relative or absolute)",
        },
        offset: {
          type: "number",
          description: "Line number to start reading from (1-indexed)",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to read",
        },
      },
      required: ["path"],
    },
    async execute(
      params: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<FsOperationOutput> {
      const { path, offset, limit } = params as {
        path: string;
        offset?: number;
        limit?: number;
      };

      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("Operation aborted"));
          return;
        }

        let aborted = false;
        const onAbort = () => {
          aborted = true;
          reject(new Error("Operation aborted"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        (async () => {
          try {
            const absolutePath = await resolveReadPathAsync(path, cwd);
            if (aborted) return;

            // Check if file exists and is readable.
            await operations.access(absolutePath);
            if (aborted) return;

            // Read text content.
            const buffer = await operations.readFile(absolutePath);
            const textContent = buffer.toString("utf-8");
            const allLines = textContent.split("\n");
            const totalFileLines = allLines.length;

            // Apply offset if specified. Convert from 1-indexed input to 0-indexed array access.
            const startLine = offset ? Math.max(0, offset - 1) : 0;
            const startLineDisplay = startLine + 1;

            // Check if offset is out of bounds.
            if (startLine >= allLines.length) {
              throw new Error(
                `Offset ${offset} is beyond end of file (${allLines.length} lines total)`,
              );
            }

            let selectedContent: string;
            let userLimitedLines: number | undefined;

            // If limit is specified by the user, honor it first. Otherwise truncateHead decides.
            if (limit !== undefined) {
              const endLine = Math.min(startLine + limit, allLines.length);
              selectedContent = allLines.slice(startLine, endLine).join("\n");
              userLimitedLines = endLine - startLine;
            } else {
              selectedContent = allLines.slice(startLine).join("\n");
            }

            // Apply truncation, respecting both line and byte limits.
            const truncation = truncateHead(selectedContent);
            let outputText: string;

            if (truncation.firstLineExceedsLimit) {
              // First line alone exceeds the byte limit. Point the model at a bash fallback.
              const firstLineSize = formatSize(
                Buffer.byteLength(allLines[startLine], "utf-8"),
              );
              outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${path} | head -c ${DEFAULT_MAX_BYTES}]`;
            } else if (truncation.truncated) {
              // Truncation occurred. Build an actionable continuation notice.
              const endLineDisplay =
                startLineDisplay + truncation.outputLines - 1;
              const nextOffset = endLineDisplay + 1;
              outputText = truncation.content;
              if (truncation.truncatedBy === "lines") {
                outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`;
              } else {
                outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
              }
            } else if (
              userLimitedLines !== undefined &&
              startLine + userLimitedLines < allLines.length
            ) {
              // User-specified limit stopped early, but the file still has more content.
              const remaining =
                allLines.length - (startLine + userLimitedLines);
              const nextOffset = startLine + userLimitedLines + 1;
              outputText = `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
            } else {
              // No truncation and no remaining user-limited content.
              outputText = truncation.content;
            }

            if (aborted) return;
            signal?.removeEventListener("abort", onAbort);
            resolve({
              content: [{ type: "text", text: outputText }],
              details: { truncation },
            });
          } catch (error: any) {
            signal?.removeEventListener("abort", onAbort);
            if (!aborted) reject(error);
          }
        })();
      });
    },
  };
}

/**
 * Create a write tool.
 */
export function createWriteTool(
  cwd: string,
  operations: FileOperations = createLocalFileOperations(),
): ToolDefinition {
  return {
    name: "write",
    label: "write",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to write (relative or absolute)",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
      required: ["path", "content"],
    },
    async execute(
      params: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<FsOperationOutput> {
      const { path, content } = params as { path: string; content: string };
      const absolutePath = resolveToCwd(path, cwd);
      const dir = absolutePath.substring(0, absolutePath.lastIndexOf("/"));

      const throwIfAborted = (): void => {
        if (signal?.aborted) throw new Error("Operation aborted");
      };

      throwIfAborted();
      // Create parent directories if needed.
      await operations.mkdir(dir);
      throwIfAborted();

      // Write the file contents.
      await operations.writeFile(absolutePath, content);
      throwIfAborted();

      return {
        content: [
          {
            type: "text",
            text: `Successfully wrote ${content.length} bytes to ${path}`,
          },
        ],
        details: undefined,
      };
    },
  };
}

/**
 * Create an ls tool.
 */
export function createLsTool(
  cwd: string,
  operations: FileOperations = createLocalFileOperations(),
): ToolDefinition {
  return {
    name: "ls",
    label: "ls",
    description: `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to 500 entries or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory to list (default: current directory)",
        },
        limit: {
          type: "number",
          description: "Maximum number of entries to return (default: 500)",
        },
      },
    },
    async execute(
      params: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<FsOperationOutput> {
      const { path, limit } = params as { path?: string; limit?: number };
      const dirPath = resolveToCwd(path || ".", cwd);
      const effectiveLimit = limit ?? 500;

      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("Operation aborted"));
          return;
        }

        const onAbort = () => reject(new Error("Operation aborted"));
        signal?.addEventListener("abort", onAbort, { once: true });

        (async () => {
          try {
            // Check if path exists.
            if (!(await operations.exists(dirPath))) {
              reject(new Error(`Path not found: ${dirPath}`));
              return;
            }

            // Check if path is a directory.
            const stat = await operations.stat(dirPath);
            if (!stat.isDirectory()) {
              reject(new Error(`Not a directory: ${dirPath}`));
              return;
            }

            // Read directory entries.
            let entries: string[];
            try {
              entries = await operations.readdir(dirPath);
            } catch (e: any) {
              reject(new Error(`Cannot read directory: ${e.message}`));
              return;
            }

            // Sort alphabetically, case-insensitive.
            entries.sort((a, b) =>
              a.toLowerCase().localeCompare(b.toLowerCase()),
            );

            // Format entries with directory indicators.
            const results: string[] = [];
            let entryLimitReached = false;
            for (const entry of entries) {
              if (results.length >= effectiveLimit) {
                entryLimitReached = true;
                break;
              }

              const fullPath = `${dirPath}/${entry}`;
              let suffix = "";
              try {
                const entryStat = await operations.stat(fullPath);
                if (entryStat.isDirectory()) suffix = "/";
              } catch {
                // Skip entries we cannot stat.
                continue;
              }
              results.push(entry + suffix);
            }

            signal?.removeEventListener("abort", onAbort);

            if (results.length === 0) {
              resolve({
                content: [{ type: "text", text: "(empty directory)" }],
                details: undefined,
              });
              return;
            }

            const rawOutput = results.join("\n");
            // Apply byte truncation. There is no separate line limit because entry count is already capped.
            const truncation = truncateHead(rawOutput, {
              maxLines: Number.MAX_SAFE_INTEGER,
            });
            let output = truncation.content;
            const details: any = {};
            // Build actionable notices for truncation and entry limits.
            const notices: string[] = [];
            if (entryLimitReached) {
              notices.push(
                `${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`,
              );
              details.entryLimitReached = effectiveLimit;
            }
            if (truncation.truncated) {
              notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
              details.truncation = truncation;
            }
            if (notices.length > 0) {
              output += `\n\n[${notices.join(". ")}]`;
            }

            resolve({
              content: [{ type: "text", text: output }],
              details: Object.keys(details).length > 0 ? details : undefined,
            });
          } catch (e: any) {
            signal?.removeEventListener("abort", onAbort);
            reject(e);
          }
        })();
      });
    },
  };
}

/**
 * Edit operations interface.
 */
export interface EditOperations {
  /** Read file contents as a Buffer */
  readFile: (absolutePath: string) => Promise<Buffer>;
  /** Write content to a file */
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  /** Check if file is readable and writable (throw if not) */
  access: (absolutePath: string) => Promise<void>;
}

/**
 * Create an edit tool.
 */
export function createEditTool(
  cwd: string,
  operations?: EditOperations,
): ToolDefinition {
  const ops: EditOperations = operations ?? {
    readFile: async (p) => {
      const { readFile } = await import("node:fs/promises");
      return readFile(p);
    },
    writeFile: async (p, content) => {
      const { writeFile } = await import("node:fs/promises");
      return writeFile(p, content, "utf-8");
    },
    access: async (p) => {
      const { access, constants } = await import("node:fs/promises");
      return access(p, constants.R_OK | constants.W_OK);
    },
  };

  return {
    name: "edit",
    label: "edit",
    description:
      "Edit a file by replacing exact text. Each edit targets a unique occurrence of oldText and replaces it with newText. Supports fuzzy matching for Unicode differences.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to edit (relative or absolute)",
        },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              oldText: {
                type: "string",
                description:
                  "Exact text to find and replace (must be unique in file)",
              },
              newText: { type: "string", description: "Replacement text" },
            },
            required: ["oldText", "newText"],
          },
          description:
            "Array of edits to apply. Each edit is matched against the original file.",
        },
      },
      required: ["path", "edits"],
    },
    async execute(
      params: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<FsOperationOutput> {
      const { path: filePath, edits } = params as {
        path: string;
        edits: Edit[];
      };
      const absolutePath = resolveToCwd(filePath, cwd);

      const throwIfAborted = (): void => {
        if (signal?.aborted) throw new Error("Operation aborted");
      };

      throwIfAborted();

      // Check if file exists.
      try {
        await ops.access(absolutePath);
      } catch (error: unknown) {
        throwIfAborted();
        const errorMessage =
          error instanceof Error && "code" in error
            ? `Error code: ${error.code}`
            : String(error);
        throw new Error(`Could not edit file: ${filePath}. ${errorMessage}.`);
      }
      throwIfAborted();

      // Read the file.
      const buffer = await ops.readFile(absolutePath);
      const rawContent = buffer.toString("utf-8");
      throwIfAborted();

      // Strip BOM before matching.
      const { bom, text: content } = stripBom(rawContent);
      const originalEnding = detectLineEnding(content);
      const normalizedContent = normalizeToLF(content);
      const { baseContent, newContent } = applyEditsToNormalizedContent(
        normalizedContent,
        edits,
        filePath,
      );
      throwIfAborted();

      const finalContent = bom + restoreLineEndings(newContent, originalEnding);
      await ops.writeFile(absolutePath, finalContent);
      throwIfAborted();

      const diffResult = generateDiffString(baseContent, newContent);
      const patch = generateUnifiedPatch(filePath, baseContent, newContent);
      return {
        content: [
          {
            type: "text",
            text: `Successfully replaced ${edits.length} block(s) in ${filePath}.`,
          },
        ],
        details: {
          diff: diffResult.diff,
          patch,
          firstChangedLine: diffResult.firstChangedLine,
        },
      };
    },
  };
}

/**
 * Create a grep tool.
 */
export function createGrepTool(cwd: string, rgPath?: string): ToolDefinition {
  return {
    name: "grep",
    label: "grep",
    description: `Search file contents using regex patterns. Uses ripgrep for fast searching. Returns matching lines with file paths and line numbers. Output is truncated to ${DEFAULT_MAX_BYTES / 1024}KB.`,
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Search pattern (regex or literal string)",
        },
        path: {
          type: "string",
          description:
            "Directory or file to search (default: current directory)",
        },
        glob: {
          type: "string",
          description:
            "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'",
        },
        ignoreCase: {
          type: "boolean",
          description: "Case-insensitive search (default: false)",
        },
        literal: {
          type: "boolean",
          description:
            "Treat pattern as literal string instead of regex (default: false)",
        },
        context: {
          type: "number",
          description:
            "Number of lines to show before and after each match (default: 0)",
        },
        limit: {
          type: "number",
          description: "Maximum number of matches to return (default: 100)",
        },
      },
      required: ["pattern"],
    },
    async execute(
      params: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<FsOperationOutput> {
      const {
        pattern,
        path: searchDir,
        glob,
        ignoreCase,
        literal,
        context,
        limit,
      } = params as {
        pattern: string;
        path?: string;
        glob?: string;
        ignoreCase?: boolean;
        literal?: boolean;
        context?: number;
        limit?: number;
      };

      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("Operation aborted"));
          return;
        }

        let settled = false;
        const settle = (fn: () => void) => {
          if (!settled) {
            settled = true;
            fn();
          }
        };

        (async () => {
          try {
            const rg = rgPath ?? "rg";
            const searchPath = resolveToCwd(searchDir || ".", cwd);
            const contextValue = context && context > 0 ? context : 0;
            const effectiveLimit = Math.max(1, limit ?? 100);

            const args: string[] = [
              "--json",
              "--line-number",
              "--color=never",
              "--hidden",
            ];
            if (ignoreCase) args.push("--ignore-case");
            if (literal) args.push("--fixed-strings");
            if (glob) args.push("--glob", glob);
            args.push("--", pattern, searchPath);

            const child = spawn(rg, args, {
              stdio: ["ignore", "pipe", "pipe"],
            });
            const rl = createInterface({ input: child.stdout });
            let stderr = "";
            let matchCount = 0;
            let matchLimitReached = false;
            let linesTruncated = false;
            let aborted = false;
            const outputLines: string[] = [];
            const matches: Array<{
              filePath: string;
              lineNumber: number;
              lineText?: string;
            }> = [];

            const cleanup = () => {
              rl.close();
              signal?.removeEventListener("abort", onAbort);
            };
            const stopChild = () => {
              if (!child.killed) child.kill();
            };
            const onAbort = () => {
              aborted = true;
              stopChild();
            };
            signal?.addEventListener("abort", onAbort, { once: true });
            child.stderr?.on("data", (chunk) => {
              stderr += chunk.toString();
            });

            rl.on("line", (line) => {
              if (!line.trim() || matchCount >= effectiveLimit) return;
              let event: any;
              try {
                event = JSON.parse(line);
              } catch {
                return;
              }
              if (event.type === "match") {
                matchCount++;
                const filePath = event.data?.path?.text;
                const lineNumber = event.data?.line_number;
                const lineText = event.data?.lines?.text;
                if (filePath && typeof lineNumber === "number")
                  matches.push({ filePath, lineNumber, lineText });
                if (matchCount >= effectiveLimit) {
                  matchLimitReached = true;
                  stopChild();
                }
              }
            });

            child.on("error", (error) => {
              cleanup();
              settle(() =>
                reject(new Error(`Failed to run ripgrep: ${error.message}`)),
              );
            });
            child.on("close", (_code) => {
              cleanup();
              if (aborted) {
                settle(() => reject(new Error("Operation aborted")));
                return;
              }

              // Format matches
              for (const match of matches) {
                const relativePath = path.relative(searchPath, match.filePath);
                const line = match.lineText?.replace(/\r?\n$/, "") ?? "";
                const { text: truncatedText, wasTruncated } =
                  truncateLine(line);
                if (wasTruncated) linesTruncated = true;
                if (contextValue > 0) {
                  outputLines.push(
                    `${relativePath}:${match.lineNumber}: ${truncatedText}`,
                  );
                } else {
                  outputLines.push(
                    `${relativePath}:${match.lineNumber}: ${truncatedText}`,
                  );
                }
              }

              let output = outputLines.join("\n");
              const truncation = truncateHead(output);
              output = truncation.content;

              const details: any = {};
              const notices: string[] = [];
              if (matchLimitReached) {
                notices.push(`${effectiveLimit} match limit reached`);
                details.matchLimitReached = effectiveLimit;
              }
              if (truncation.truncated) {
                notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
                details.truncation = truncation;
              }
              if (linesTruncated) {
                notices.push("Long lines truncated");
                details.linesTruncated = true;
              }
              if (notices.length > 0) {
                output += `\n\n[${notices.join(". ")}]`;
              }

              settle(() =>
                resolve({
                  content: [
                    { type: "text", text: output || "(no matches found)" },
                  ],
                  details:
                    Object.keys(details).length > 0 ? details : undefined,
                }),
              );
            });
          } catch (e: any) {
            settle(() => reject(e));
          }
        })();
      });
    },
  };
}

/**
 * Create a find tool.
 */
export function createFindTool(cwd: string, fdPath?: string): ToolDefinition {
  return {
    name: "find",
    label: "find",
    description: `Find files by glob pattern. Uses fd for fast file discovery. Output is truncated to ${DEFAULT_MAX_BYTES / 1024}KB.`,
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
        },
        path: {
          type: "string",
          description: "Directory to search in (default: current directory)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default: 1000)",
        },
      },
      required: ["pattern"],
    },
    async execute(
      params: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<FsOperationOutput> {
      const {
        pattern,
        path: searchDir,
        limit,
      } = params as {
        pattern: string;
        path?: string;
        limit?: number;
      };

      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("Operation aborted"));
          return;
        }

        const onAbort = () => reject(new Error("Operation aborted"));
        signal?.addEventListener("abort", onAbort, { once: true });

        (async () => {
          try {
            const fd = fdPath ?? "fd";
            const searchPath = resolveToCwd(searchDir || ".", cwd);
            const effectiveLimit = Math.max(1, limit ?? 1000);

            const args: string[] = [
              "--color=never",
              "--hidden",
              "--type",
              "file",
              "--type",
              "symlink",
            ];
            args.push("--glob", pattern);
            args.push("--max-results", String(effectiveLimit));
            args.push(".", searchPath);

            const child = spawn(fd, args, {
              stdio: ["ignore", "pipe", "pipe"],
            });
            const rl = createInterface({ input: child.stdout });
            let stderr = "";
            let aborted = false;
            const outputLines: string[] = [];

            const cleanup = () => {
              rl.close();
              signal?.removeEventListener("abort", onAbort);
            };
            const onAbortChild = () => {
              aborted = true;
              if (!child.killed) child.kill();
            };
            signal?.addEventListener("abort", onAbortChild, { once: true });
            child.stderr?.on("data", (chunk) => {
              stderr += chunk.toString();
            });

            rl.on("line", (line) => {
              const trimmed = line.trim();
              if (trimmed) {
                const relativePath = path.relative(searchPath, trimmed);
                outputLines.push(relativePath || ".");
              }
            });

            child.on("error", (error) => {
              cleanup();
              reject(new Error(`Failed to run fd: ${error.message}`));
            });
            child.on("close", (_code) => {
              cleanup();
              if (aborted) {
                reject(new Error("Operation aborted"));
                return;
              }

              if (_code !== 0 && _code !== 1) {
                // code 1 means no matches, which is valid
                reject(new Error(`fd exited with code ${_code}: ${stderr}`));
                return;
              }

              if (outputLines.length === 0) {
                resolve({
                  content: [{ type: "text", text: "(no files found)" }],
                  details: undefined,
                });
                return;
              }

              let output = outputLines.join("\n");
              const truncation = truncateHead(output);
              output = truncation.content;

              const details: any = {};
              const notices: string[] = [];
              if (outputLines.length >= effectiveLimit) {
                notices.push(`${effectiveLimit} result limit reached`);
                details.resultLimitReached = effectiveLimit;
              }
              if (truncation.truncated) {
                notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
                details.truncation = truncation;
              }
              if (notices.length > 0) {
                output += `\n\n[${notices.join(". ")}]`;
              }

              resolve({
                content: [{ type: "text", text: output }],
                details: Object.keys(details).length > 0 ? details : undefined,
              });
            });
          } catch (e: any) {
            reject(e);
          }
        })();
      });
    },
  };
}

/**
 * Create a tool factory.
 */
export function createToolFactory() {
  return {
    createReadTool: (operations?: FileOperations) =>
      createReadTool(process.cwd(), operations),
    createWriteTool: (operations?: FileOperations) =>
      createWriteTool(process.cwd(), operations),
    createLsTool: (operations?: FileOperations) =>
      createLsTool(process.cwd(), operations),
    createEditTool: (operations?: EditOperations) =>
      createEditTool(process.cwd(), operations),
    createGrepTool: (rgPath?: string) => createGrepTool(process.cwd(), rgPath),
    createFindTool: (fdPath?: string) => createFindTool(process.cwd(), fdPath),
  };
}
