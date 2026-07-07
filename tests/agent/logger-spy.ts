/**
 * SpyLogger — test double that records all log calls.
 *
 * @module logger-spy
 */
import type { Logger } from "../../src/logger.js";

/** Recorded log call. */
export interface LogCall {
  level: "error" | "warn" | "info" | "debug";
  component: string;
  event: string;
  data?: Record<string, unknown>;
  error?: Error;
}

/**
 * Test-friendly Logger implementation that records all calls
 * for assertion in tests. No file I/O, no side effects.
 */
export class SpyLogger implements Logger {
  /** All recorded log calls. */
  public calls: LogCall[] = [];

  /** Current session ID (for assertion). */
  public sessionId: string | null = null;

  error(
    component: string,
    event: string,
    data?: Record<string, unknown>,
    error?: Error,
  ): void {
    this.calls.push({ level: "error", component, event, data, error });
  }

  warn(component: string, event: string, data?: Record<string, unknown>): void {
    this.calls.push({ level: "warn", component, event, data });
  }

  info(component: string, event: string, data?: Record<string, unknown>): void {
    this.calls.push({ level: "info", component, event, data });
  }

  debug(
    component: string,
    event: string,
    data?: Record<string, unknown>,
  ): void {
    this.calls.push({ level: "debug", component, event, data });
  }

  setSessionId(sessionId: string | null): void {
    this.sessionId = sessionId;
  }

  async close(): Promise<void> {
    // no-op
  }

  // ==========================================================================
  // Assertion helpers
  // ==========================================================================

  /** Get calls for a specific level. */
  getCallsForLevel(level: LogCall["level"]): LogCall[] {
    return this.calls.filter((c) => c.level === level);
  }

  /** Get calls for a specific component. */
  getCallsForComponent(component: string): LogCall[] {
    return this.calls.filter((c) => c.component === component);
  }

  /** Get calls for a specific event. */
  getCallsForEvent(event: string): LogCall[] {
    return this.calls.filter((c) => c.event === event);
  }

  /** Check if a specific event was logged. */
  hasEvent(event: string): boolean {
    return this.calls.some((c) => c.event === event);
  }

  /** Clear all recorded calls. */
  clear(): void {
    this.calls = [];
  }
}
