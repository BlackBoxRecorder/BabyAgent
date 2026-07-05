/**
 * Path utilities for the fs-tool package.
 * These utilities are framework-agnostic and can be used in any project.
 */

import { constants, accessSync } from "node:fs";
import { access } from "node:fs/promises";
import { normalize, resolve, sep } from "node:path";

/**
 * Check if a file exists synchronously.
 */
export function fileExists(filePath: string): boolean {
	try {
		accessSync(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if a file exists asynchronously.
 */
export async function pathExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Normalize a path, handling Unicode spaces and @ prefix.
 */
export function normalizePath(filePath: string): string {
	// Remove leading @ if present (used for relative paths in some contexts)
	const withoutAt = filePath.startsWith("@") ? filePath.slice(1) : filePath;
	// Normalize Unicode spaces to regular spaces
	const withNormalizedSpaces = withoutAt.replace(
		/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g,
		" ",
	);
	return normalize(withNormalizedSpaces);
}

/**
 * Resolve a path relative to the given cwd.
 * Handles ~ expansion and absolute paths.
 */
export function resolvePath(filePath: string, cwd: string): string {
	// Handle home directory expansion
	if (filePath.startsWith("~")) {
		const home = process.env.HOME || process.env.USERPROFILE || "";
		filePath = home + filePath.slice(1);
	}

	// Handle absolute paths
	if (
		filePath.startsWith("/") ||
		filePath.startsWith("\\") ||
		/^[A-Z]:/i.test(filePath)
	) {
		return normalizePath(filePath);
	}

	// Handle relative paths
	const resolved = resolve(cwd, filePath);
	return normalizePath(resolved);
}

/**
 * Resolve a path relative to the given cwd with additional macOS handling.
 */
export function resolveToCwd(filePath: string, cwd: string): string {
	return resolvePath(filePath, cwd);
}

/**
 * Convert a path to POSIX format (forward slashes).
 */
export function toPosixPath(filePath: string): string {
	return filePath.split(sep).join("/");
}

/**
 * Try macOS screenshot path variant (narrow no-break space before AM/PM).
 */
export function tryMacOSScreenshotPath(filePath: string): string {
	const NARROW_NO_BREAK_SPACE = "\u202F";
	return filePath.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`);
}

/**
 * Try NFD variant (macOS stores filenames in NFD form).
 */
export function tryNFDVariant(filePath: string): string {
	return filePath.normalize("NFD");
}

/**
 * Try curly quote variant (macOS uses U+2019 in screenshot names).
 */
export function tryCurlyQuoteVariant(filePath: string): string {
	return filePath.replace(/'/g, "\u2019");
}

/**
 * Resolve a read path with macOS-specific fallbacks.
 */
export function resolveReadPath(filePath: string, cwd: string): string {
	const resolved = resolveToCwd(filePath, cwd);

	if (fileExists(resolved)) {
		return resolved;
	}

	// Try macOS AM/PM variant (narrow no-break space before AM/PM)
	const amPmVariant = tryMacOSScreenshotPath(resolved);
	if (amPmVariant !== resolved && fileExists(amPmVariant)) {
		return amPmVariant;
	}

	// Try NFD variant (macOS stores filenames in NFD form)
	const nfdVariant = tryNFDVariant(resolved);
	if (nfdVariant !== resolved && fileExists(nfdVariant)) {
		return nfdVariant;
	}

	// Try curly quote variant (macOS uses U+2019 in screenshot names)
	const curlyVariant = tryCurlyQuoteVariant(resolved);
	if (curlyVariant !== resolved && fileExists(curlyVariant)) {
		return curlyVariant;
	}

	// Try combined NFD + curly quote (for French macOS screenshots like "Capture d'écran")
	const nfdCurlyVariant = tryCurlyQuoteVariant(nfdVariant);
	if (nfdCurlyVariant !== resolved && fileExists(nfdCurlyVariant)) {
		return nfdCurlyVariant;
	}

	return resolved;
}

/**
 * Resolve a read path asynchronously with macOS-specific fallbacks.
 */
export async function resolveReadPathAsync(
	filePath: string,
	cwd: string,
): Promise<string> {
	const resolved = resolveToCwd(filePath, cwd);

	if (await pathExists(resolved)) {
		return resolved;
	}

	// Try macOS AM/PM variant (narrow no-break space before AM/PM)
	const amPmVariant = tryMacOSScreenshotPath(resolved);
	if (amPmVariant !== resolved && (await pathExists(amPmVariant))) {
		return amPmVariant;
	}

	// Try NFD variant (macOS stores filenames in NFD form)
	const nfdVariant = tryNFDVariant(resolved);
	if (nfdVariant !== resolved && (await pathExists(nfdVariant))) {
		return nfdVariant;
	}

	// Try curly quote variant (macOS uses U+2019 in screenshot names)
	const curlyVariant = tryCurlyQuoteVariant(resolved);
	if (curlyVariant !== resolved && (await pathExists(curlyVariant))) {
		return curlyVariant;
	}

	// Try combined NFD + curly quote (for French macOS screenshots like "Capture d'écran")
	const nfdCurlyVariant = tryCurlyQuoteVariant(nfdVariant);
	if (nfdCurlyVariant !== resolved && (await pathExists(nfdCurlyVariant))) {
		return nfdCurlyVariant;
	}

	return resolved;
}
