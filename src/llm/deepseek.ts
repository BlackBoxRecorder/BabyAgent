/**
 * DeepSeek API client implementation using native fetch.
 */
import type {
  LLMClient,
  LLMStreamChunk,
  Message,
  ToolCall,
  TokenUsage,
  DeepSeekRequestConfig,
  DeepSeekConfig,
} from "./types.js";
import type { LLMFunctionDef } from "../tools/interface/index.js";

export class DeepSeekClient implements LLMClient {
  private config: Required<Omit<DeepSeekConfig, "defaults">> & {
    defaults: Required<DeepSeekRequestConfig>;
  };

  /** The model id currently in use — can be changed at runtime via setDefaultModel(). */
  private currentModel: string;

  private static DEFAULT_BASE_URL = "https://api.deepseek.com";
  private static DEFAULT_REQUEST_CONFIG: Omit<
    Required<DeepSeekRequestConfig>,
    "model"
  > = {
    thinking: { type: "enabled" },
    reasoning_effort: "high",
    max_tokens: 1000 * 64,
    temperature: 1,
    top_p: 1,
    tool_choice: "auto",
    stream: false,
  };

  constructor(config: DeepSeekConfig) {
    this.currentModel = config.defaults?.model ?? "deepseek-v4-flash";
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? DeepSeekClient.DEFAULT_BASE_URL,
      defaults: {
        model: this.currentModel,
        ...DeepSeekClient.DEFAULT_REQUEST_CONFIG,
        ...config.defaults,
      },
    };
  }

  /**
   * Switch the default model at runtime.
   * Subsequent chatStream calls will use this model unless overridden in options.
   */
  setDefaultModel(modelId: string): void {
    this.currentModel = modelId;
    this.config.defaults.model = modelId;
  }

  /**
   * Build request body payload for DeepSeek API.
   */
  private _buildRequestBody(
    messages: Message[],
    tools?: LLMFunctionDef[],
    options?: Record<string, unknown>,
  ): Record<string, any> {
    const mergedConfig = {
      ...this.config.defaults,
      ...options,
    } as DeepSeekRequestConfig;

    return {
      model: mergedConfig.model,
      messages,
      thinking: mergedConfig.thinking,
      reasoning_effort: mergedConfig.reasoning_effort,
      max_tokens: mergedConfig.max_tokens,
      temperature: mergedConfig.temperature,
      top_p: mergedConfig.top_p,
      tool_choice: mergedConfig.tool_choice,
      stream: true,
      tools: tools?.length ? tools : null,
    };
  }

  async *chatStream(
    messages: Message[],
    tools?: LLMFunctionDef[],
    options?: Record<string, unknown>,
  ): AsyncGenerator<LLMStreamChunk> {
    const body = this._buildRequestBody(messages, tools, options);

    // Use AbortController instead of AbortSignal.timeout() so we can
    // clear the timer after the stream finishes — otherwise the timeout
    // timer keeps the event loop alive for up to 60s after completion.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `DeepSeek API error (${response.status}): ${errorText}`,
        );
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Aggregated response fields
      let content = "";
      let reasoningContent = "";
      const toolCalls: ToolCall[] = [];
      let finishReason: "stop" | "tool_calls" | "length" | undefined;
      let usage: TokenUsage | undefined;

      const CHUNK_READ_TIMEOUT = 30000; // 30s between chunks

      try {
        while (true) {
          // Read with timeout between chunks
          let chunkTimeoutId: ReturnType<typeof setTimeout> | undefined;
          let readResult: Awaited<ReturnType<typeof reader.read>>;

          try {
            readResult = await Promise.race([
              reader.read(),
              new Promise<never>((_, reject) => {
                chunkTimeoutId = setTimeout(
                  () => reject(new Error("Stream read timeout")),
                  CHUNK_READ_TIMEOUT,
                );
              }),
            ]);
          } finally {
            if (chunkTimeoutId !== undefined) clearTimeout(chunkTimeoutId);
          }

          const { done, value } = readResult;

          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;

            const data = trimmed.slice(6); // Remove "data: " prefix
            if (data === "[DONE]") {
              // Produce final chunk with accumulated results
              yield {
                delta: {},
                finish_reason: finishReason,
                usage,
                accumulated: {
                  content: content || null,
                  tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                  finish_reason: finishReason ?? "stop",
                  reasoning_content: reasoningContent || undefined,
                },
              };
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const choice = parsed.choices?.[0];
              const delta = choice?.delta;

              // Accumulate fields
              if (delta?.content) content += delta.content;
              if (delta?.reasoning_content)
                reasoningContent += delta.reasoning_content;
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx: number = tc.index ?? 0;
                  if (!toolCalls[idx]) {
                    toolCalls[idx] = {
                      id: "",
                      type: "function",
                      function: { name: "", arguments: "" },
                    };
                  }
                  if (tc.id) toolCalls[idx].id = tc.id;
                  if (tc.function?.name)
                    toolCalls[idx].function.name += tc.function.name;
                  if (tc.function?.arguments)
                    toolCalls[idx].function.arguments += tc.function.arguments;
                }
              }

              if (choice?.finish_reason) {
                finishReason = choice.finish_reason;
              }
              if (parsed.usage) {
                usage = {
                  prompt_tokens: parsed.usage.prompt_tokens ?? 0,
                  completion_tokens: parsed.usage.completion_tokens ?? 0,
                  total_tokens: parsed.usage.total_tokens ?? 0,
                  prompt_cache_hit_tokens: parsed.usage.prompt_cache_hit_tokens,
                  prompt_cache_miss_tokens:
                    parsed.usage.prompt_cache_miss_tokens,
                  completion_tokens_details:
                    parsed.usage.completion_tokens_details,
                };
              }

              yield {
                delta: {
                  content: delta?.content,
                  reasoning_content: delta?.reasoning_content,
                  tool_calls: delta?.tool_calls,
                },
                finish_reason: choice?.finish_reason,
              };
            } catch {
              // Skip malformed JSON chunks
            }
          }
        }
      } finally {
        // Release the reader lock so the underlying TCP connection can
        // be returned to the pool / closed promptly.
        try {
          reader.cancel();
        } catch {
          // Ignore — reader may already be released
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
