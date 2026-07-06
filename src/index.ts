/**
 * babyAgent - Lightweight terminal AI agent
 *
 * @module baby-agent
 */

// Core components
export { Agent } from "./agent.js";
export { ConversationCoordinator } from "./coordinator.js";
export { SessionManager } from "./session.js";

// LLM
export { ChatClient } from "./llm/llm.js";

// Logger
export {
  Logger,
  getLogger,
  logError,
  logWarn,
  logInfo,
  logDebug,
} from "./logger.js";

// Types
export type { Message, TokenUsage, BillingInfo } from "./llm/index.js";
export type { AgentConfig, AgentResult, AgentStreamEvent } from "./agent.js";
export type {
  CoordinatorConfig,
  ExecuteTurnOptions,
  TurnEvent,
} from "./coordinator.js";
export type { SessionMeta, TurnRecord } from "./session.js";

// Logger types
export { LogLevel } from "./logger.js";
