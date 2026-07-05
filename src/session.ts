import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import type {
  Message,
  TokenUsage,
  TurnUsage,
  BillingInfo,
} from "./llm/index.js";

// ============================================================================
// Types
// ============================================================================

/** Session metadata stored to disk and exposed to callers. */
export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
}

/** A single turn record appended as a line after the meta line. */
export interface TurnRecord {
  type: "turn";
  timestamp: string;
  userInput: string;
  messages: Message[];
  usage?: TokenUsage;
  /** Aggregated turn-level token usage (sum of all LLM calls) */
  turnUsage?: TurnUsage;
  /** Computed billing for this turn */
  billing?: BillingInfo;
}

// ============================================================================
// SessionManager
// ============================================================================

/**
 * Stores each session as two files:
 *   {sessionId}.jsonl      — turns only, pure append (O(1) per turn)
 *   {sessionId}.meta.json  — lightweight metadata (~150 bytes)
 */
export class SessionManager {
  private sessionsDir: string;

  constructor(sessionsDir?: string) {
    this.sessionsDir =
      sessionsDir ?? path.join(os.homedir(), ".babyAgent", "sessions");
  }

  // ==========================================================================
  // Public API — Write
  // ==========================================================================

  /** Create a new session. Writes the meta file (turns file created on first append). */
  async createSession(firstUserInput: string): Promise<SessionMeta> {
    await this._ensureDir();

    const id = this._generateSessionId();
    const now = new Date().toISOString();
    const title = firstUserInput.slice(0, 50);

    const meta: SessionMeta = {
      id,
      title,
      createdAt: now,
      updatedAt: now,
      turnCount: 0,
    };
    await this._writeMeta(id, meta);

    return meta;
  }

  /** Append a turn record. O(1): append to JSONL + overwrite tiny meta file. */
  async appendTurn(sessionId: string, record: TurnRecord): Promise<void> {
    const meta = await this._readMeta(sessionId);
    if (!meta) {
      throw new Error(`Session "${sessionId.slice(0, 8)}" not found.`);
    }

    // Append turn line (O(1) append)
    await fs.appendFile(
      this._getTurnsPath(sessionId),
      JSON.stringify(record) + "\n",
      "utf-8",
    );

    // Update meta (tiny file, constant time)
    meta.updatedAt = new Date().toISOString();
    meta.turnCount += 1;
    await this._writeMeta(sessionId, meta);
  }

  /** Update the session title. */
  async updateTitle(sessionId: string, title: string): Promise<void> {
    const meta = await this._readMeta(sessionId);
    if (!meta) {
      throw new Error(`Session "${sessionId.slice(0, 8)}" not found.`);
    }
    meta.title = title;
    await this._writeMeta(sessionId, meta);
  }

  // ==========================================================================
  // Public API — Read
  // ==========================================================================

  /** List all sessions, sorted by updatedAt descending. */
  async listSessions(): Promise<SessionMeta[]> {
    await this._ensureDir();
    const files = await fs.readdir(this.sessionsDir);
    const metaFiles = files.filter((f) => f.endsWith(".meta.json"));

    const sessions: SessionMeta[] = [];
    for (const file of metaFiles) {
      const meta = await this._readMetaFile(path.join(this.sessionsDir, file));
      if (meta) sessions.push(meta);
    }

    sessions.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return sessions;
  }

  /** Load all messages from a session (turns only, no meta line to skip). */
  async loadMessages(sessionId: string): Promise<Message[]> {
    const filePath = this._getTurnsPath(sessionId);
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      return []; // File may not exist yet (session created but no turns)
    }

    const allMessages: Message[] = [];
    const lines = content.trim().split("\n");
    for (const line of lines) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "turn" && Array.isArray(parsed.messages)) {
          allMessages.push(...parsed.messages);
        }
      } catch {
        console.warn(
          `[SessionManager] Skipping malformed line in session ${sessionId}`,
        );
      }
    }

    return allMessages;
  }

  /** Get metadata for a single session, or null if not found. */
  async getSessionMeta(sessionId: string): Promise<SessionMeta | null> {
    return this._readMeta(sessionId);
  }

  /** Load full TurnRecords from a session (includes usage/billing per turn). */
  async loadTurnRecords(sessionId: string): Promise<TurnRecord[]> {
    const filePath = this._getTurnsPath(sessionId);
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      return [];
    }

    const records: TurnRecord[] = [];
    const lines = content.trim().split("\n");
    for (const line of lines) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "turn") {
          records.push(parsed as TurnRecord);
        }
      } catch {
        // Skip malformed lines
      }
    }

    return records;
  }

  // ==========================================================================
  // Private helpers — file paths
  // ==========================================================================

  private _getTurnsPath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.jsonl`);
  }

  private _getMetaPath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.meta.json`);
  }

  // ==========================================================================
  // Private helpers — I/O
  // ==========================================================================

  private async _writeMeta(
    sessionId: string,
    meta: SessionMeta,
  ): Promise<void> {
    await fs.writeFile(
      this._getMetaPath(sessionId),
      JSON.stringify(meta, null, 2),
      "utf-8",
    );
  }

  private async _readMeta(sessionId: string): Promise<SessionMeta | null> {
    return this._readMetaFile(this._getMetaPath(sessionId));
  }

  private async _readMetaFile(filePath: string): Promise<SessionMeta | null> {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const obj = JSON.parse(raw) as SessionMeta;
      if (obj && typeof obj.id === "string") return obj;
      return null;
    } catch {
      return null;
    }
  }

  private async _ensureDir(): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
  }

  /**
   * Generate a unique session ID: {8-char hex}-{ISO datetime without separators}
   * Example: "a1b2c3d4-20260704T103000"
   */
  private _generateSessionId(): string {
    const hex = crypto.randomBytes(4).toString("hex");
    const dateStr = new Date()
      .toISOString()
      .replace(/-/g, "")
      .replace(/:/g, "")
      .replace(/\..+Z$/, "");
    return `${hex}-${dateStr}`;
  }
}
