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
import { getLogger } from "./logger.js";

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
  systemPrompt: string;
  /** Maximum ReAct iterations (prevents infinite loops), default: 10 */
  maxIterations?: number;
}

/** Result of an agent run */
export interface AgentResult {
  success: boolean;
  content: string;
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

// ============================================================================
// Agent Implementation
// ============================================================================

export class Agent {
  private llm: LLMClient;
  private toolRegistry: ToolRegistry;
  private systemPrompt: string;
  private maxIterations: number;
  private _conversationMessages: Message[] = [];
  private _currentModel: string;
  private logger = getLogger();

  constructor(config: AgentConfig) {
    this.llm = config.llm;
    this.systemPrompt = config.systemPrompt;
    this.maxIterations = config.maxIterations ?? 100;
    this._currentModel = config.llm.currentModelId;

    this.toolRegistry = new DefaultToolRegistry();
    for (const tool of config.tools) {
      this.toolRegistry.register(tool);
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

  /** Current conversation messages (owned by the Agent). */
  get conversationMessages(): readonly Message[] {
    return this._conversationMessages;
  }

  /** Replace the current conversation message list (e.g. on session switch). */
  setConversationMessages(messages: Message[]): void {
    this._conversationMessages = [...messages];
  }

  /** Rotate to the next model in the LLM client's model list. */
  switchModel(): void {
    this.llm.switchModel();
    this._currentModel = this.llm.currentModelId;
  }

  /**
   * Run the agent with a pre-built message list (for session continuation).
   * The caller is responsible for including system + user messages.
   * Yields streaming events for real-time display.
   */
  async *runWithMessages(
    inputMessages: Message[],
  ): AsyncGenerator<AgentStreamEvent> {
    // Copy input — Agent owns its message list, does not mutate caller's array.
    const messages = [...inputMessages];

    let iterations = 0;

    while (iterations < this.maxIterations) {
      iterations++;

      // 1. Call LLM with streaming
      let fullResponse: LLMResponse | undefined;
      for await (const chunk of this.llm.chatStream(
        messages,
        this.toolRegistry.getToolsForLLM(),
      )) {
        yield { type: "chunk", chunk };
        if (chunk.fullResponse) {
          fullResponse = chunk.fullResponse;
        }
      }

      if (!fullResponse) {
        this.logger.warn("agent", "llm_no_response", { iteration: iterations });
        const result: AgentResult = {
          success: false,
          content: "No response from LLM",
          iterations,
          allMessages: messages,
        };
        this._conversationMessages = messages;
        yield { type: "done", result };
        return result;
      }

      if (
        fullResponse.finish_reason === "length" ||
        fullResponse.finish_reason === "content_filter" ||
        fullResponse.finish_reason === "insufficient_system_resource"
      ) {
        this.logger.warn("agent", "llm error stop", { iteration: iterations });
        const result: AgentResult = {
          success: false,
          content: fullResponse.finish_reason,
          iterations,
          allMessages: messages,
        };
        this._conversationMessages = messages;
        yield { type: "done", result };
        return result;
      } else if (fullResponse.finish_reason === "stop") {
        const result: AgentResult = {
          success: true,
          content: fullResponse.content ?? fullResponse.finish_reason,
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
        content: fullResponse.content,
        tool_calls: fullResponse.tool_calls,
      } as Message;
      messages.push(assistantMessage);

      for (const toolCall of fullResponse.tool_calls ?? []) {
        const toolName = toolCall.function.name;
        const tool = this.toolRegistry.getTool(toolName);

        this.logger.info("agent", "tool_call", {
          tool: toolName,
          callId: toolCall.id,
          params: toolCall.function.arguments,
        });

        // Execute tool with safety net: convert thrown exceptions to
        // ToolResult errors so the agent loop continues and the turn
        // can be persisted (prevents orphaned session meta files).
        let result: ToolResult;
        let params: Record<string, any> = {};
        try {
          // 1. 检查工具是否存在
          if (!tool) {
            throw new Error(`Tool "${toolName}" not found`);
          }

          // 2. 解析参数
          try {
            params = JSON.parse(toolCall.function.arguments);
          } catch (parseError) {
            throw new Error(
              `Failed to parse tool arguments: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
            );
          }

          // 3. 执行工具
          result = await tool.execute(params);

          this.logger.info("agent", "tool_result", {
            tool: toolName,
            success: result.success,
            outputLength: result.output?.length ?? 0,
          });
        } catch (err) {
          // 统一处理所有错误
          result = {
            success: false,
            output: "",
            error: err instanceof Error ? err.message : String(err),
          };

          // 根据错误类型记录日志
          if (!tool) {
            this.logger.warn("agent", "tool_not_found", { tool: toolName });
          } else if (result.error?.includes("Failed to parse tool arguments")) {
            this.logger.warn("agent", "tool_argument_parse_error", {
              tool: toolName,
              error: result.error,
            });
          } else {
            this.logger.error(
              "agent",
              "tool_error",
              {
                tool: toolName,
                error: result.error,
              },
              err instanceof Error ? err : new Error(String(err)),
            );
          }
        }
        yield { type: "tool_result", tool: toolName, params, result };

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }

    // Reached max iterations
    this.logger.warn("agent", "max_iterations_reached", {
      maxIterations: this.maxIterations,
    });
    const result: AgentResult = {
      success: false,
      content: "Maximum ReAct iterations reached without a final response.",

      iterations,
      allMessages: messages,
    };
    this._conversationMessages = messages;
    yield { type: "done", result };
    return result;
  }
}
