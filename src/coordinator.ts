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
  | { type: "agent_error"; error: string };

/** Configuration for ConversationCoordinator. */
export interface CoordinatorConfig {
  agent: Agent;
  sessionManager: SessionManager;
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

  /** Resume a persisted session, restoring its full message history. */
  async resumeSession(sessionId: string): Promise<SessionMeta> {
    const meta = await this.sessionManager.getSessionMeta(sessionId);
    if (!meta) {
      throw new Error(`Session "${sessionId.slice(0, 8)}" not found.`);
    }
    const loaded = await this.sessionManager.loadMessages(sessionId);
    this._sessionId = sessionId;
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
  async *executeTurn(userInput: string): AsyncGenerator<TurnEvent, void> {
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
}
