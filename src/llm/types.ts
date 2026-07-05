/**
 * Core types for the LLM package — messages, responses, tool calls,
 * streaming chunks, and the LLM client interface.
 *
 * These types are provider-agnostic where possible, though some
 * DeepSeek-specific fields are included for convenience.
 */

// ============================================================================
// Message Types
// ============================================================================

/** System message: sets behavior/context for the model. */
export interface SystemMessage {
  role: "system";
  content: string;
}

/** User message: input from the user. */
export interface UserMessage {
  role: "user";
  content: string;
}

/**
 * Assistant message: response from the model.
 * content can be null when the model makes tool calls.
 * tool_calls present when the model invokes tools.
 */
export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
}

/**
 * Tool message: result of a tool execution.
 * tool_call_id is required, referencing the original tool call.
 */
export interface ToolMessage {
  role: "tool";
  content: string;
  tool_call_id: string;
}

/** A single message in the conversation — discriminated by `role`. */
export type Message =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;

// ============================================================================
// Tool Call Types
// ============================================================================

/** Tool call from LLM response. */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

// ============================================================================
// Response Types
// ============================================================================

/** LLM response from the chat completion API. */
export interface LLMResponse {
  content: string | null;
  tool_calls?: ToolCall[];
  finish_reason: "stop" | "tool_calls" | "length";
  reasoning_content?: string;
  /** Token usage stats from the API response */
  usage?: TokenUsage;
}

/** Token usage statistics from the API. */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** Cached prompt tokens (DeepSeek) */
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  /** Breakdown of completion tokens (DeepSeek) */
  completion_tokens_details?: {
    reasoning_tokens: number;
  };
}

// ============================================================================
// Streaming Types
// ============================================================================

/**
 * A single chunk from the streaming chat completion API.
 * The last chunk includes accumulated full response.
 */
export interface LLMStreamChunk {
  /** Incremental content from this chunk */
  delta: {
    content?: string;
    reasoning_content?: string;
    tool_calls?: ToolCall[];
  };
  /** Only present in the last chunk */
  finish_reason?: "stop" | "tool_calls" | "length";
  /** Only present in the last chunk */
  usage?: TokenUsage;
  /** Aggregated full response — only present in the last chunk */
  accumulated?: LLMResponse;
}

// ============================================================================
// Configuration Types
// ============================================================================

/** DeepSeek request-level configuration (can override defaults per call). */
export interface DeepSeekRequestConfig {
  model?: string;
  thinking?: {
    type: "enabled" | "disabled";
  };
  reasoning_effort?: "high" | "max";
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  tool_choice?: "none" | "auto" | "required";
  stream?: boolean;
}

/** DeepSeek client configuration. */
export interface DeepSeekConfig {
  apiKey: string;
  baseUrl?: string;
  defaults?: DeepSeekRequestConfig;
}

import type { LLMFunctionDef } from "../tools/interface/index.js";

// ============================================================================
// LLM Client Interface
// ============================================================================

/** LLM client interface for chat completion with tool support. */
export interface LLMClient {
  chatStream(
    messages: Message[],
    tools?: LLMFunctionDef[],
    options?: Record<string, unknown>,
  ): AsyncGenerator<LLMStreamChunk>;
}
