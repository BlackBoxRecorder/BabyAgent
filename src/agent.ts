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
import { type ToolRegistry, type ToolResult } from "./tools/interface/index.js";
import type { Logger } from "./logger.js";
import { getLogger } from "./logger.js";

// ============================================================================
// Types
// ============================================================================

/** Configuration for the Agent */
export interface AgentConfig {
  /** LLM client for chat completion */
  llm: LLMClient;
  /** Tool registry for looking up and executing tools */
  toolRegistry: ToolRegistry;
  /** System prompt for the conversation */
  systemPrompt: string;
  /** Maximum ReAct iterations (prevents infinite loops), default: 10 */
  maxIterations?: number;
  /** Logger instance (optional, defaults to global logger) */
  logger?: Logger;
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

/**
 * Abstract interface for Agent session state.
 * Decouples the Coordinator from the concrete Agent implementation,
 * making the seam between them explicit and testable.
 */
export interface AgentSession {
  /** Current conversation messages. */
  getMessages(): readonly Message[];
  /** Replace the conversation message list (e.g. on session switch). */
  setMessages(messages: Message[]): void;
  /** The system prompt for the conversation. */
  getSystemPrompt(): string;
  /** Currently active model ID. */
  getCurrentModel(): string;
  /** Rotate to the next model in the LLM client's model list. */
  switchModel(): void;
  /**
   * Run the agent with a pre-built message list (for session continuation).
   * The caller is responsible for including system + user messages.
   * Yields streaming events for real-time display.
   */
  runWithMessages(inputMessages: Message[]): AsyncGenerator<AgentStreamEvent>;
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

export class Agent implements AgentSession {
  private llm: LLMClient;
  private toolRegistry: ToolRegistry;
  private systemPrompt: string;
  private maxIterations: number;
  private _conversationMessages: Message[] = [];
  private _currentModel: string;
  private logger: Logger;

  constructor(config: AgentConfig) {
    this.llm = config.llm;
    this.systemPrompt = config.systemPrompt;
    this.maxIterations = config.maxIterations ?? 100;
    this._currentModel = config.llm.currentModelId;
    this.logger = config.logger ?? getLogger();
    this.toolRegistry = config.toolRegistry;
  }

  // ==========================================================================
  // AgentSession interface implementation
  // ==========================================================================

  /** Current conversation messages (owned by the Agent). */
  getMessages(): readonly Message[] {
    return this._conversationMessages;
  }

  /** Replace the current conversation message list (e.g. on session switch). */
  setMessages(messages: Message[]): void {
    this._conversationMessages = [...messages];
  }

  /** The system prompt for the conversation. */
  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  /** Currently active model ID. */
  getCurrentModel(): string {
    return this._currentModel;
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

    let funcDef = this.toolRegistry.getToolsForLLM();

    while (iterations < this.maxIterations) {
      iterations++;

      // 1. Call LLM with streaming
      let fullResponse: LLMResponse | undefined;
      for await (const chunk of this.llm.chatStream(messages, funcDef)) {
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
      } else if (fullResponse.finish_reason === "tool_calls") {
        // tool call
        // Defensive: the LLM may return finish_reason="tool_calls" with an
        // empty/undefined tool_calls array.  Treat this as a protocol
        // inconsistency and fall back to "stop" if there is content,
        // otherwise abort as an error.
        if (!fullResponse.tool_calls || fullResponse.tool_calls.length === 0) {
          this.logger.warn("agent", "tool_calls_finish_with_empty_tools", {
            iteration: iterations,
            content: fullResponse.content,
          });

          if (fullResponse.content) {
            // Treat as normal stop — the model likely meant to reply
            const result: AgentResult = {
              success: true,
              content: fullResponse.content,
              iterations,
              allMessages: messages,
            };
            this._conversationMessages = messages;
            yield { type: "done", result };
            return result;
          }

          // No content and no tool calls — unrecoverable
          const result: AgentResult = {
            success: false,
            content:
              "LLM returned finish_reason=tool_calls but no tool_calls and no content",
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

        for (const toolCall of fullResponse.tool_calls) {
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

            // ------------------------------------------------------------------
            // Special handling: Skill meta-tool
            // The Skill tool returns skill content in metadata.  We inject it
            // as a system message into the local messages array so the model
            // sees the skill instructions on the very next iteration in the
            // same turn (no need to wait for the next user turn).
            // ------------------------------------------------------------------
            if (
              toolName === "Skill" &&
              result.success &&
              result.metadata?.skillContent
            ) {
              const skillName = result.metadata.skillName as string;
              const skillContent = result.metadata.skillContent as string;
              const skillHash = result.metadata.skillContentHash as string;

              // Dedup: check if this skill (same name + same content) is
              // already injected into the conversation.
              const existingIdx = (messages as any[]).findIndex(
                (m: any) => m.role === "system" && m._skillName === skillName,
              );

              if (existingIdx >= 0 && skillHash) {
                const existingHash = (messages[existingIdx] as any)._skillHash;
                if (existingHash === skillHash) {
                  // Identical content already loaded — note it in the tool
                  // result instead of duplicating the system message.
                  result = {
                    ...result,
                    output: `Skill "${skillName}" is already loaded and active.`,
                  };
                } else {
                  // Content changed — replace the existing system message.
                  messages[existingIdx] = {
                    role: "system",
                    content: `<active_skill name="${skillName}">\n${skillContent}\n</active_skill>`,
                    _skillName: skillName,
                    _skillHash: skillHash,
                  } as any;
                }
              } else {
                // First injection — insert after the primary system prompt.
                const sysIdx = (messages as any[]).findIndex(
                  (m: any) => m.role === "system",
                );
                const insertIdx = sysIdx >= 0 ? sysIdx + 1 : 1;
                (messages as any[]).splice(insertIdx, 0, {
                  role: "system",
                  content: `<active_skill name="${skillName}">\n${skillContent}\n</active_skill>`,
                  _skillName: skillName,
                  _skillHash: skillHash,
                });
              }
            }

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
            } else if (
              result.error?.includes("Failed to parse tool arguments")
            ) {
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
      } else {
        throw new Error("error finish_reason");
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
