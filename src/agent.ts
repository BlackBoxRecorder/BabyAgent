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
  TurnUsage,
  BillingInfo,
} from "./llm/index.js";
import {
  DefaultToolRegistry,
  type Tool,
  type ToolRegistry,
  type ToolResult,
} from "./tools/interface/index.js";
import type { ModelInfo } from "./llm/models-config.js";

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
  /** Available models with cost rates (for billing computation) */
  models?: ModelInfo[];
  /** Default model ID at startup */
  defaultModel?: string;
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
  /** Aggregated turn-level token usage (only on successful turns) */
  usage?: TurnUsage;
  /** Computed billing for this turn (only on successful turns) */
  billing?: BillingInfo;
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
  private _currentModel: string;
  private _lastContextSize: number = 0;
  private models: ModelInfo[];

  constructor(config: AgentConfig) {
    this.llm = config.llm;
    this.systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.maxIterations = config.maxIterations ?? 100;
    this.models = config.models ?? [];
    this._currentModel = config.defaultModel ?? "unknown";

    this.registry = new DefaultToolRegistry();
    for (const tool of config.tools) {
      this.registry.register(tool);
    }
  }

  /** Expose the system prompt so callers can build message lists. */
  get systemPromptText(): string {
    return this.systemPrompt;
  }

  /** Currently active model ID. */
  get currentModel(): string {
    return this._currentModel;
  }

  /** Last known context size (prompt_tokens from last successful LLM call). */
  get lastContextSize(): number {
    return this._lastContextSize;
  }

  /** Current conversation messages (owned by the Agent). */
  get conversationMessages(): readonly Message[] {
    return this._conversationMessages;
  }

  /** Replace the current conversation message list (e.g. on session switch). */
  setConversationMessages(messages: Message[]): void {
    this._conversationMessages = [...messages];
  }

  /** Switch the LLM model at runtime (pass-through to client). */
  setModel(modelId: string): void {
    this._currentModel = modelId;
    this.llm.setDefaultModel(modelId);
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

    // Accumulate token usage across all LLM calls in this turn
    let accPromptTokens = 0;
    let accCompletionTokens = 0;
    let accTotalTokens = 0;
    let accCacheHitTokens = 0;
    let accCacheMissTokens = 0;
    let accReasoningTokens = 0;

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

      // Accumulate usage from this LLM call
      if (accumulatedResponse.usage) {
        const u = accumulatedResponse.usage;
        accPromptTokens += u.prompt_tokens;
        accCompletionTokens += u.completion_tokens;
        accTotalTokens += u.total_tokens;
        accCacheHitTokens += u.prompt_cache_hit_tokens ?? 0;
        accCacheMissTokens += u.prompt_cache_miss_tokens ?? 0;
        accReasoningTokens +=
          u.completion_tokens_details?.reasoning_tokens ?? 0;
        // Update context size from last successful LLM call's prompt_tokens
        this._lastContextSize = u.prompt_tokens;
      }

      // 2. If no tool calls, return final result with usage & billing
      if (
        !accumulatedResponse.tool_calls ||
        accumulatedResponse.tool_calls.length === 0
      ) {
        const usage: TurnUsage = {
          promptTokens: accPromptTokens,
          completionTokens: accCompletionTokens,
          totalTokens: accTotalTokens,
          cacheHitTokens: accCacheHitTokens,
          cacheMissTokens: accCacheMissTokens,
          reasoningTokens: accReasoningTokens,
        };
        const billing = this._computeBilling(usage);

        const result: AgentResult = {
          success: true,
          content: accumulatedResponse.content ?? "",
          toolCalls: toolCallsLog,
          iterations,
          allMessages: messages,
          usage,
          billing,
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

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /** Compute billing from usage and current model's cost rates. */
  private _computeBilling(usage: TurnUsage): BillingInfo | undefined {
    const modelInfo = this.models.find((m) => m.id === this._currentModel);
    if (!modelInfo) return undefined;

    const cost = modelInfo.cost;
    const inputCost = usage.promptTokens * cost.input;
    const outputCost = usage.completionTokens * cost.output;
    const cacheReadCost = usage.cacheHitTokens * cost.cacheRead;
    const cacheWriteCost = usage.cacheMissTokens * cost.cacheWrite;
    const totalCost = inputCost + outputCost + cacheReadCost + cacheWriteCost;

    return { inputCost, outputCost, cacheReadCost, cacheWriteCost, totalCost };
  }
}
