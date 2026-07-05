/**
 * File operations for the fs-tool package.
 * These operations are framework-agnostic and can be used in any project.
 */

import { constants } from "node:fs";
import {
	access as fsAccess,
	mkdir as fsMkdir,
	readFile as fsReadFile,
	readdir as fsReaddir,
	stat as fsStat,
	writeFile as fsWriteFile,
} from "node:fs/promises";
import type { FileOperations } from "./types.js";

/**
 * Create local file system operations.
 * This is the default implementation for local file system access.
 */
export function createLocalFileOperations(): FileOperations {
	return {
		readFile: (path) => fsReadFile(path),
		writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
		access: (path) => fsAccess(path, constants.R_OK),
		mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
		stat: (path) => fsStat(path),
		readdir: (path) => fsReaddir(path),
		exists: async (path) => {
			try {
				await fsAccess(path, constants.F_OK);
				return true;
			} catch {
				return false;
			}
		},
	};
}

/**
 * Create read-only file system operations.
 * This is useful for tools that only need to read files.
 */
export function createReadOnlyFileOperations(): FileOperations {
	const localOps = createLocalFileOperations();
	return {
		...localOps,
		writeFile: async () => {
			throw new Error("Write operation not supported in read-only mode");
		},
		mkdir: async () => {
			throw new Error("Mkdir operation not supported in read-only mode");
		},
	};
}

/**
 * Create mock file system operations for testing.
 */
export function createMockFileOperations(
	files: Record<string, string> = {},
): FileOperations {
	const fileMap = new Map<string, Buffer>();
	for (const [path, content] of Object.entries(files)) {
		fileMap.set(path, Buffer.from(content, "utf-8"));
	}

	return {
		readFile: async (path) => {
			const content = fileMap.get(path);
			if (!content) {
				throw new Error(`File not found: ${path}`);
			}
			return content;
		},
		writeFile: async (path, content) => {
			fileMap.set(path, Buffer.from(content, "utf-8"));
		},
		access: async (path) => {
			if (!fileMap.has(path)) {
				throw new Error(`File not found: ${path}`);
			}
		},
		mkdir: async () => {},
		stat: async (path) => {
			if (!fileMap.has(path)) {
				throw new Error(`Path not found: ${path}`);
			}
			return {
				isDirectory: () => false,
			};
		},
		readdir: async () => {
			return Array.from(fileMap.keys());
		},
		exists: async (path) => {
			return fileMap.has(path);
		},
	};
}
