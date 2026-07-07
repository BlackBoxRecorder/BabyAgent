/**
 * Generic LLM client — provider-agnostic chat completions with model rotation.
 *
 * Uses the OpenAI-compatible /chat/completions endpoint via native fetch.
 * Supports multiple models across providers via a flat ModelEntry list.
 */
import type {
  LLMClient,
  LLMStreamChunk,
  Message,
  ToolCall,
  TokenUsage,
  BillingInfo,
} from "./types.js";
import type { LLMFunctionDef } from "../tools/interface/index.js";
import type { ModelEntry } from "./models.js";
import type { BillingCalculator } from "./billing.js";
import { DefaultBillingCalculator } from "./billing.js";

export class ChatClient implements LLMClient {
  private models: ModelEntry[];
  private _currentModelIndex = 0;
  private billingCalculator: BillingCalculator;

  constructor(models: ModelEntry[], billingCalculator?: BillingCalculator) {
    if (models.length === 0) {
      throw new Error("ChatClient requires at least one model entry.");
    }
    this.models = models;
    this.billingCalculator =
      billingCalculator ?? new DefaultBillingCalculator();
  }

  /** The model ID currently in use. */
  get currentModelId(): string {
    return this.models[this._currentModelIndex].modelId;
  }

  /**
   * Rotate to the next model in the list.
   * Wraps around to index 0 after the last model.
   */
  switchModel(): void {
    this._currentModelIndex =
      (this._currentModelIndex + 1) % this.models.length;
  }

  async *chatStream(
    messages: Message[],
    tools?: LLMFunctionDef[],
  ): AsyncGenerator<LLMStreamChunk> {
    const model = this.models[this._currentModelIndex];

    const body = {
      model: model.modelId,
      messages,
      reasoning_effort: "max",
      max_tokens: model.maxTokens,
      stream: true,
      tools: tools?.length ? tools : null,
    };

    // Use AbortController instead of AbortSignal.timeout() so we can
    // clear the timer after the stream finishes — otherwise the timeout
    // timer keeps the event loop alive for up to 60s after completion.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(`${model.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${model.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API error (${response.status}): ${errorText}`);
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
      let billing: BillingInfo | undefined;
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
                billing,
                usage,
                fullResponse: {
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

              if (usage) {
                billing = this.billingCalculator.compute(
                  usage,
                  this.models[this._currentModelIndex].cost,
                );
              }

              yield {
                delta: {
                  content: delta?.content,
                  reasoning_content: delta?.reasoning_content,
                  tool_calls: delta?.tool_calls,
                },
                finish_reason: choice?.finish_reason,
                usage: usage,
                billing: billing,
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
