/**
 * Logger module — thin pino wrapper.
 *
 * @module logger
 */
import pino from "pino";
import { createWriteStream, mkdirSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ============================================================================
// Log Levels
// ============================================================================

/** Log severity levels (kept for backward compatibility). */
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

// ============================================================================
// Logger Wrapper
// ============================================================================

/**
 * Thin wrapper around pino that preserves the existing
 * `(component, event, data?, error?)` call signature.
 */
export class Logger {
  private static instance: Logger | null = null;

  private pino: pino.Logger;
  private _sessionId: string | null = null;
  private _logFileStream: ReturnType<typeof createWriteStream> | null = null;

  private constructor() {
    const logDir =
      process.env["BABY_AGENT_LOG_DIR"] ||
      path.join(os.homedir(), ".babyAgent", "logs");
    mkdirSync(logDir, { recursive: true });

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const logFile = path.join(logDir, `app-${dateStr}--${timeStr}.log`);

    this._logFileStream = createWriteStream(logFile, { flags: "a" });

    this.pino = pino(
      { level: process.env["BABY_AGENT_LOG_LEVEL"] || "debug" },
      this._logFileStream,
    );
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  // ==========================================================================
  // Log methods
  // ==========================================================================

  error(
    component: string,
    event: string,
    data?: Record<string, unknown>,
    error?: Error,
  ): void {
    this.pino.error(this._buildMeta(component, event, data, error), event);
  }

  warn(component: string, event: string, data?: Record<string, unknown>): void {
    this.pino.warn(this._buildMeta(component, event, data), event);
  }

  info(component: string, event: string, data?: Record<string, unknown>): void {
    this.pino.info(this._buildMeta(component, event, data), event);
  }

  debug(
    component: string,
    event: string,
    data?: Record<string, unknown>,
  ): void {
    this.pino.debug(this._buildMeta(component, event, data), event);
  }

  // ==========================================================================
  // Session
  // ==========================================================================

  setSessionId(sessionId: string | null): void {
    this._sessionId = sessionId;
  }

  // ==========================================================================
  // Lifecycle (no-op stubs for backward compatibility)
  // ==========================================================================

  configure(_updates: Record<string, unknown>): void {
    // no-op: pino configuration is set at construction time
  }

  async flush(): Promise<void> {
    // no-op: pino writes synchronously by default
  }

  async close(): Promise<void> {
    if (this._logFileStream) {
      this._logFileStream.end();
      this._logFileStream = null;
    }
    Logger.instance = null;
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private _buildMeta(
    component: string,
    event: string,
    data?: Record<string, unknown>,
    error?: Error,
  ): Record<string, unknown> {
    const meta: Record<string, unknown> = { component, event };
    if (this._sessionId) meta.sessionId = this._sessionId;
    if (data) Object.assign(meta, data);
    if (error) meta.err = error;
    return meta;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

let _singleton: Logger | null = null;

export function getLogger(): Logger {
  if (!_singleton) {
    _singleton = Logger.getInstance();
  }
  return _singleton;
}

export function logError(
  component: string,
  event: string,
  data?: Record<string, unknown>,
  error?: Error,
): void {
  getLogger().error(component, event, data, error);
}

export function logWarn(
  component: string,
  event: string,
  data?: Record<string, unknown>,
): void {
  getLogger().warn(component, event, data);
}

export function logInfo(
  component: string,
  event: string,
  data?: Record<string, unknown>,
): void {
  getLogger().info(component, event, data);
}

export function logDebug(
  component: string,
  event: string,
  data?: Record<string, unknown>,
): void {
  getLogger().debug(component, event, data);
}
