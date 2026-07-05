/**
 * ConversationCoordinator — manages session lifecycle and turn execution.
 *
 * Sits between CLI (display) and Agent + SessionManager (logic + persistence).
 * Owns conversation state so display adapters (CLI, future TUI) don't need to.
 */
import type { Message } from "./llm/index.js";
import { Agent, type AgentStreamEvent, type AgentResult } from "./agent.js";
import {
  SessionManager,
  type SessionMeta,
  type TurnRecord,
} from "./session.js";

// ============================================================================
// Types
// ============================================================================

/** Events yielded during turn execution. Extends Agent's own events. */
export type TurnEvent =
  | AgentStreamEvent
  | { type: "session_created"; sessionId: string; title: string }
  | { type: "save_error"; error: string }
  | { type: "agent_error"; error: string }
  | { type: "aborted" };

/** Configuration for ConversationCoordinator. */
export interface CoordinatorConfig {
  agent: Agent;
  sessionManager: SessionManager;
}

/** Options for executeTurn. */
export interface ExecuteTurnOptions {
  /** Signal to abort the turn mid-execution. */
  signal?: AbortSignal;
}

// ============================================================================
// Coordinator
// ============================================================================

export class ConversationCoordinator {
  private agent: Agent;
  private sessionManager: SessionManager;
  private _sessionId: string | null = null;

  constructor(config: CoordinatorConfig) {
    this.agent = config.agent;
    this.sessionManager = config.sessionManager;
  }

  // ==========================================================================
  // Read-only state (for display adapters)
  // ==========================================================================

  get currentSessionId(): string | null {
    return this._sessionId;
  }

  // ==========================================================================
  // Session lifecycle
  // ==========================================================================

  /** Discard current session and start fresh. */
  newSession(): void {
    this._sessionId = null;
    this.agent.setConversationMessages([]);
  }

  /** List all persisted sessions, most recent first. */
  async listSessions(): Promise<SessionMeta[]> {
    return this.sessionManager.listSessions();
  }

  /** Get current session messages (excluding system prompt) for display. */
  getSessionMessages(): Message[] {
    const all = this.agent.conversationMessages as Message[];
    // Skip the first message if it's the system prompt
    if (all.length > 0 && all[0].role === "system") {
      return all.slice(1);
    }
    return [...all];
  }

  /** Resume a persisted session, restoring its full message history.
   *  Supports both full session IDs and short 8-char prefixes (from /sessions). */
  async resumeSession(sessionId: string): Promise<SessionMeta> {
    let resolvedId = sessionId;

    // 1. Try exact match first.
    let meta = await this.sessionManager.getSessionMeta(sessionId);

    // 2. If not found, try prefix matching (supports short IDs from /sessions).
    if (!meta) {
      const allSessions = await this.sessionManager.listSessions();
      const matches = allSessions.filter((s) => s.id.startsWith(sessionId));
      if (matches.length === 0) {
        throw new Error(`Session "${sessionId.slice(0, 8)}" not found.`);
      }
      if (matches.length > 1) {
        const ids = matches.map((s) => s.id.slice(0, 20)).join(", ");
        throw new Error(
          `Ambiguous prefix "${sessionId}": matches ${matches.length} sessions (${ids}...). Use a longer prefix or full ID.`,
        );
      }
      resolvedId = matches[0].id;
      meta = matches[0];
    }

    const loaded = await this.sessionManager.loadMessages(resolvedId);
    this._sessionId = resolvedId;
    this.agent.setConversationMessages([
      { role: "system", content: this.agent.systemPromptText },
      ...loaded,
    ]);
    return meta;
  }

  // ==========================================================================
  // Turn execution
  // ==========================================================================

  /**
   * Execute one user-input turn through the Agent, saving the result.
   * Yields streaming events for real-time display.
   */
  async *executeTurn(
    userInput: string,
    options?: ExecuteTurnOptions,
  ): AsyncGenerator<TurnEvent, void> {
    // Auto-create session on first message
    if (this._sessionId === null) {
      const meta = await this.sessionManager.createSession(userInput);
      this._sessionId = meta.id;
      this.agent.setConversationMessages([
        { role: "system", content: this.agent.systemPromptText },
      ]);
      yield {
        type: "session_created",
        sessionId: meta.id,
        title: meta.title,
      };
    }

    // Build turn input from agent's current conversation state.
    const messagesBefore = this.agent.conversationMessages.length;
    const turnInput: Message[] = [
      ...this.agent.conversationMessages,
      { role: "user", content: userInput },
    ];

    // Run Agent (Agent copies input internally — no mutation on our array)
    let result: AgentResult | undefined;
    try {
      for await (const event of this.agent.runWithMessages(turnInput)) {
        // Check abort signal every event to allow early termination
        if (options?.signal?.aborted) {
          yield { type: "aborted" };
          // Persist partial turn before returning
          yield* this.persistPartialTurn(
            userInput,
            messagesBefore,
            turnInput,
            "Turn aborted by user.",
          );
          return;
        }
        if (event.type === "done") {
          result = event.result;
        }
        yield event;
      }
    } catch (agentErr) {
      // Safety net: if the agent crashes after session creation, save an
      // error turn to prevent orphaned meta files (meta.json without .jsonl).
      const errorMsg =
        agentErr instanceof Error ? agentErr.message : String(agentErr);

      if (this._sessionId) {
        const errorTurn: TurnRecord = {
          type: "turn",
          timestamp: new Date().toISOString(),
          userInput,
          messages: [
            ...turnInput.slice(messagesBefore),
            {
              role: "assistant",
              content: `Agent error: ${errorMsg}`,
            } as Message,
          ],
        };
        try {
          await this.sessionManager.appendTurn(this._sessionId, errorTurn);
        } catch (saveErr) {
          yield {
            type: "save_error",
            error: saveErr instanceof Error ? saveErr.message : String(saveErr),
          };
        }
      }

      // Restore message history to before the failed turn so the next
      // turn starts from a clean state.
      this.agent.setConversationMessages(
        this.agent.conversationMessages.slice(0, messagesBefore),
      );

      yield { type: "agent_error", error: errorMsg };
      return;
    }

    // Agent updates its internal state automatically in runWithMessages.
    // No need to manually sync — conversationMessages is already up to date.

    // Persist the turn
    if (this._sessionId && result) {
      const turnMessages = result.allMessages.slice(messagesBefore);
      if (turnMessages.length > 0) {
        const turnRecord: TurnRecord = {
          type: "turn",
          timestamp: new Date().toISOString(),
          userInput,
          messages: turnMessages,
        };
        try {
          await this.sessionManager.appendTurn(this._sessionId, turnRecord);
        } catch (err) {
          yield {
            type: "save_error",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
    }
  }

  // ==========================================================================
  // Private: partial turn persistence (used on abort)
  // ==========================================================================

  /** Persist a partial turn when execution is aborted mid-stream. */
  private async *persistPartialTurn(
    userInput: string,
    messagesBefore: number,
    turnInput: Message[],
    note: string,
  ): AsyncGenerator<{ type: "save_error"; error: string }, void> {
    if (!this._sessionId) return;

    // Restore conversation state to before the failed turn
    this.agent.setConversationMessages(
      this.agent.conversationMessages.slice(0, messagesBefore),
    );

    const partialTurn: TurnRecord = {
      type: "turn",
      timestamp: new Date().toISOString(),
      userInput,
      messages: [
        ...turnInput.slice(messagesBefore),
        {
          role: "assistant",
          content: `[${note}]`,
        } as Message,
      ],
    };
    try {
      await this.sessionManager.appendTurn(this._sessionId, partialTurn);
    } catch (err) {
      yield {
        type: "save_error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
