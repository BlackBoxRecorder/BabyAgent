/**
 * ReAct-based Agent implementation.
 *
 * The agent runs a loop:
 * 1. Send user input + conversation history to LLM
 * 2. If LLM returns tool_calls → execute tools, send results back
 * 3. If LLM returns stop → return final response
 * 4. Repeat until max iterations
 */
import type {
  LLMClient,
  LLMResponse,
  LLMStreamChunk,
  Message,
} from "./llm/index.js";
import {
  DefaultToolRegistry,
  type Tool,
  type ToolRegistry,
  type ToolResult,
} from "./tools/interface/index.js";

// ============================================================================
// Types
// ============================================================================

/** Configuration for the Agent */
export interface AgentConfig {
  /** LLM client for chat completion */
  llm: LLMClient;
  /** Tools available to the agent */
  tools: Tool[];
  /** System prompt for the conversation */
  systemPrompt?: string;
  /** Maximum ReAct iterations (prevents infinite loops), default: 10 */
  maxIterations?: number;
}

/** Result of an agent run */
export interface AgentResult {
  success: boolean;
  content: string;
  toolCalls: ToolCallLog[];
  iterations: number;
  /** All messages produced during this run (input + output).
   *  The caller must NOT mutate the input array — Agent copies it internally. */
  allMessages: Message[];
}

/** Events emitted during a streaming agent run */
export type AgentStreamEvent =
  | { type: "chunk"; chunk: LLMStreamChunk }
  | {
      type: "tool_result";
      tool: string;
      params: Record<string, any>;
      result: ToolResult;
    }
  | { type: "done"; result: AgentResult };

/** Log entry for a tool call */
export interface ToolCallLog {
  tool: string;
  params: Record<string, any>;
  result: ToolResult;
}

// ============================================================================
// Agent Implementation
// ============================================================================

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful AI agent. You have access to tools to help complete tasks. " +
  "Use tools when needed to gather information or perform actions. " +
  "When you have enough information, respond directly to the user.";

export class Agent {
  private llm: LLMClient;
  private registry: ToolRegistry;
  private systemPrompt: string;
  private maxIterations: number;
  private _conversationMessages: Message[] = [];

  constructor(config: AgentConfig) {
    this.llm = config.llm;
    this.systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.maxIterations = config.maxIterations ?? 100;

    this.registry = new DefaultToolRegistry();
    for (const tool of config.tools) {
      this.registry.register(tool);
    }
  }

  /** Expose the system prompt so callers can build message lists. */
  get systemPromptText(): string {
    return this.systemPrompt;
  }

  /** Current conversation messages (owned by the Agent). */
  get conversationMessages(): readonly Message[] {
    return this._conversationMessages;
  }

  /** Replace the current conversation message list (e.g. on session switch). */
  setConversationMessages(messages: Message[]): void {
    this._conversationMessages = [...messages];
  }

  /**
   * Run the agent with a pre-built message list (for session continuation).
   * The caller is responsible for including system + user messages.
   * Yields streaming events for real-time display.
   */
  async *runWithMessages(
    inputMessages: Message[],
  ): AsyncGenerator<AgentStreamEvent, AgentResult> {
    // Copy input — Agent owns its message list, does not mutate caller's array.
    const messages = [...inputMessages];

    const toolCallsLog: ToolCallLog[] = [];
    let iterations = 0;

    while (iterations < this.maxIterations) {
      iterations++;

      // 1. Call LLM with streaming
      let accumulatedResponse: LLMResponse | undefined;
      for await (const chunk of this.llm.chatStream(
        messages,
        this.registry.getToolsForLLM(),
        { tool_choice: "auto" },
      )) {
        yield { type: "chunk", chunk };
        if (chunk.accumulated) {
          accumulatedResponse = chunk.accumulated;
        }
      }

      if (!accumulatedResponse) {
        const result: AgentResult = {
          success: false,
          content: "No response from LLM",
          toolCalls: toolCallsLog,
          iterations,
          allMessages: messages,
        };
        this._conversationMessages = messages;
        yield { type: "done", result };
        return result;
      }

      // 2. If no tool calls, return final result
      if (
        !accumulatedResponse.tool_calls ||
        accumulatedResponse.tool_calls.length === 0
      ) {
        const result: AgentResult = {
          success: true,
          content: accumulatedResponse.content ?? "",
          toolCalls: toolCallsLog,
          iterations,
          allMessages: messages,
        };
        this._conversationMessages = messages;
        yield { type: "done", result };
        return result;
      }

      // 3. Execute tool calls
      const assistantMessage = {
        role: "assistant" as const,
        content: accumulatedResponse.content,
        tool_calls: accumulatedResponse.tool_calls,
      } as Message;
      messages.push(assistantMessage);

      for (const toolCall of accumulatedResponse.tool_calls) {
        const toolName = toolCall.function.name;
        const tool = this.registry.getTool(toolName);

        if (!tool) {
          const errorResult: ToolResult = {
            success: false,
            output: "",
            error: `Tool "${toolName}" not found`,
          };
          toolCallsLog.push({
            tool: toolName,
            params: {},
            result: errorResult,
          });
          yield {
            type: "tool_result",
            tool: toolName,
            params: {},
            result: errorResult,
          };
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(errorResult),
          });
          continue;
        }

        // Parse arguments and execute
        let params: Record<string, any> = {};
        try {
          params = JSON.parse(toolCall.function.arguments);
        } catch {
          const parseError: ToolResult = {
            success: false,
            output: "",
            error: "Failed to parse tool arguments",
          };
          toolCallsLog.push({
            tool: toolName,
            params: {},
            result: parseError,
          });
          yield {
            type: "tool_result",
            tool: toolName,
            params: {},
            result: parseError,
          };
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(parseError),
          });
          continue;
        }

        // Execute tool with safety net: convert thrown exceptions to
        // ToolResult errors so the agent loop continues and the turn
        // can be persisted (prevents orphaned session meta files).
        let result: ToolResult;
        try {
          result = await tool.execute(params);
        } catch (err) {
          result = {
            success: false,
            output: "",
            error: err instanceof Error ? err.message : String(err),
          };
        }
        toolCallsLog.push({ tool: toolName, params, result });
        yield { type: "tool_result", tool: toolName, params, result };

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }

    // Reached max iterations
    const result: AgentResult = {
      success: false,
      content: "Maximum ReAct iterations reached without a final response.",
      toolCalls: toolCallsLog,
      iterations,
      allMessages: messages,
    };
    this._conversationMessages = messages;
    yield { type: "done", result };
    return result;
  }

  /**
   * Run the agent on a single user input (convenience method).
   * Builds [system, user] messages and delegates to runWithMessages().
   */
  async *run(userInput: string): AsyncGenerator<AgentStreamEvent, AgentResult> {
    const messages: Message[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: userInput },
    ];
    return yield* this.runWithMessages(messages);
  }
}

// Re-export coordinator for convenience
export { ConversationCoordinator } from "./coordinator.js";
export type { TurnEvent, CoordinatorConfig } from "./coordinator.js";

// Re-export LLM client for convenience
export { DeepSeekClient } from "./llm/index.js";
export type { DeepSeekConfig } from "./llm/types.js";
