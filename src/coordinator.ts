/**
 * ConversationCoordinator — manages session lifecycle and turn execution.
 *
 * Sits between CLI (display) and Agent + SessionManager (logic + persistence).
 * Owns conversation state so display adapters (CLI, future TUI) don't need to.
 */
import type { Message, TokenUsage, BillingInfo } from "./llm/index.js";
import { Agent, type AgentStreamEvent, type AgentResult } from "./agent.js";
import {
  SessionManager,
  type SessionMeta,
  type TurnRecord,
} from "./session.js";
import { getLogger } from "./logger.js";

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
  /** Session-level accumulated token usage (sum of all completed Turns). */
  private _sessionUsage: TokenUsage = _zeroUsage();
  /** Session-level accumulated billing (sum of all completed Turns). */
  private _sessionBilling: BillingInfo = _zeroBilling();
  private logger = getLogger();

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

  /** Get the currently active model ID. */
  get currentModel(): string {
    return this.agent.currentModel;
  }

  /** Session-level accumulated token usage, or null if no turns completed. */
  get sessionUsage(): TokenUsage | null {
    return this._sessionUsage.total_tokens > 0 ? this._sessionUsage : null;
  }

  /** Session-level accumulated billing, or null if no turns completed. */
  get sessionBilling(): BillingInfo | null {
    return this._sessionBilling.totalCost > 0 ? this._sessionBilling : null;
  }

  // ==========================================================================
  // Session lifecycle
  // ==========================================================================

  /** Discard current session and start fresh. */
  newSession(): void {
    const previousSessionId = this._sessionId;
    this._sessionId = null;
    this._sessionUsage = _zeroUsage();
    this._sessionBilling = _zeroBilling();
    this.agent.setConversationMessages([]);

    this.logger.info("coordinator", "new_session", {
      previousSessionId,
    });

    // Clear logger session ID
    this.logger.setSessionId(null);
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

  /** Rotate to the next model (pass-through to agent). */
  switchModel(): void {
    this.agent.switchModel();
  }

  /** Resume a persisted session, restoring its full message history.
   *  Supports both full session IDs and short 8-char prefixes (from /sessions). */
  async resumeSession(sessionId: string): Promise<SessionMeta | null> {
    let resolvedId = sessionId;

    let meta = await this.sessionManager.getSessionMeta(sessionId);

    const loaded = await this.sessionManager.loadMessages(resolvedId);
    this._sessionId = resolvedId;
    this.agent.setConversationMessages([
      { role: "system", content: this.agent.systemPromptText },
      ...loaded,
    ]);

    // Update logger session ID
    this.logger.setSessionId(resolvedId);

    // Accumulate historical turn usage & billing for the info bar
    this._sessionUsage = _zeroUsage();
    this._sessionBilling = _zeroBilling();
    const records = await this.sessionManager.loadTurnRecords(resolvedId);

    for (const rec of records) {
      this._accumulateTurn(rec.usage, rec.billing);
    }

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

      this.logger.info("coordinator", "session_created", {
        sessionId: meta.id,
        title: meta.title,
      });

      // Update logger session ID
      this.logger.setSessionId(meta.id);

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
          return;
        }
        if (event.type === "done") {
          result = event.result;
        }

        if (event.type === "chunk") {
          // Accumulate session stats BEFORE yielding so display adapters
          // (TUI info bar, etc.) see the updated values immediately.
          this._accumulateTurn(event.chunk.usage, event.chunk.billing);
        }

        yield event;
      }
    } catch (agentErr) {
      // Safety net: if the agent crashes after session creation, save an
      // error turn to prevent orphaned meta files (meta.json without .jsonl).
      const errorMsg =
        agentErr instanceof Error ? agentErr.message : String(agentErr);

      this.logger.error(
        "coordinator",
        "agent_error",
        {
          sessionId: this._sessionId,
          error: errorMsg,
        },
        agentErr instanceof Error ? agentErr : new Error(String(agentErr)),
      );

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
          this.logger.info("coordinator", "error_turn_saved", {
            sessionId: this._sessionId,
          });
        } catch (saveErr) {
          this.logger.error("coordinator", "save_error", {
            sessionId: this._sessionId,
            error: saveErr instanceof Error ? saveErr.message : String(saveErr),
          });
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

    // Persist the turn with usage & billing
    if (this._sessionId && result) {
      const turnMessages = result.allMessages.slice(messagesBefore);
      if (turnMessages.length > 0) {
        const turnRecord: TurnRecord = {
          type: "turn",
          timestamp: new Date().toISOString(),
          userInput,
          messages: turnMessages,
          usage: this._sessionUsage,
          billing: this._sessionBilling,
        };
        try {
          await this.sessionManager.appendTurn(this._sessionId, turnRecord);
        } catch (err) {
          this.logger.error("coordinator", "turn_save_error", {
            sessionId: this._sessionId,
            error: err instanceof Error ? err.message : String(err),
          });
          yield {
            type: "save_error",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
    }
  }

  // ==========================================================================
  // Private: session stats accumulation
  // ==========================================================================

  /** Accumulate a Turn's usage & billing into the session totals. */
  private _accumulateTurn(
    usage: TokenUsage | undefined,
    billing: BillingInfo | undefined,
  ): void {
    if (usage) {
      this._sessionUsage.prompt_tokens += usage.prompt_tokens;
      this._sessionUsage.completion_tokens += usage.completion_tokens;
      this._sessionUsage.total_tokens += usage.total_tokens;
      this._sessionUsage.prompt_cache_hit_tokens =
        (this._sessionUsage.prompt_cache_hit_tokens ?? 0) +
        (usage.prompt_cache_hit_tokens ?? 0);
      this._sessionUsage.prompt_cache_miss_tokens =
        (this._sessionUsage.prompt_cache_miss_tokens ?? 0) +
        (usage.prompt_cache_miss_tokens ?? 0);
      const existingReasoning =
        this._sessionUsage.completion_tokens_details?.reasoning_tokens ?? 0;
      const addedReasoning =
        usage.completion_tokens_details?.reasoning_tokens ?? 0;
      this._sessionUsage.completion_tokens_details = {
        reasoning_tokens: existingReasoning + addedReasoning,
      };
    }

    if (billing) {
      this._sessionBilling.inputCost += billing.inputCost;
      this._sessionBilling.outputCost += billing.outputCost;
      this._sessionBilling.cacheReadCost += billing.cacheReadCost;
      this._sessionBilling.cacheWriteCost += billing.cacheWriteCost;
      this._sessionBilling.totalCost += billing.totalCost;
    }
  }
}

// ============================================================================
// Module-level helpers
// ============================================================================

function _zeroUsage(): TokenUsage {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: 0,
    completion_tokens_details: { reasoning_tokens: 0 },
  };
}

function _zeroBilling(): BillingInfo {
  return {
    inputCost: 0,
    outputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    totalCost: 0,
  };
}
