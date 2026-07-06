/**
 * Tests for ConversationCoordinator — turn execution and session persistence.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Agent } from "../../src/agent.js";
import { SessionManager } from "../../src/session.js";
import { ConversationCoordinator } from "../../src/coordinator.js";
import type {
  LLMClient,
  LLMStreamChunk,
  Message,
} from "../../src/llm/index.js";
import type { Tool, ToolResult } from "../../src/tools/interface/index.js";

// ============================================================================
// Mock LLM Client — returns a tool call response, then a final text response
// ============================================================================

/**
 * Creates a mock LLM client that first responds with a tool call,
 * then (if re-invoked) responds with a plain text message.
 */
function createMockLLMWithToolCall(
  toolName: string,
  toolArgs: Record<string, any> = {},
): LLMClient {
  let callCount = 0;

  async function* chatStream(
    _messages: Message[],
    _tools?: any[],
  ): AsyncGenerator<LLMStreamChunk> {
    callCount++;
    if (callCount === 1) {
      // First call: respond with a tool call
      yield {
        delta: {},
        finish_reason: "tool_calls",
        accumulated: {
          content: null,
          tool_calls: [
            {
              id: "call_001",
              type: "function",
              function: {
                name: toolName,
                arguments: JSON.stringify(toolArgs),
              },
            },
          ],
          finish_reason: "tool_calls",
        },
      };
    } else {
      // Second call: respond with plain text (tool result received)
      yield {
        delta: {},
        finish_reason: "stop",
        accumulated: {
          content: "Done after tool call.",
          tool_calls: undefined,
          finish_reason: "stop",
        },
      };
    }
  }

  return { chatStream, switchModel: () => {}, currentModelId: "mock-model" };
}

/**
 * Creates a mock LLM client that throws on first call.
 */
function createThrowingMockLLM(errorMsg: string): LLMClient {
  async function* chatStream(): AsyncGenerator<LLMStreamChunk> {
    throw new Error(errorMsg);
  }

  return { chatStream, switchModel: () => {}, currentModelId: "mock-model" };
}

// ============================================================================
// Helpers
// ============================================================================

/** Consume all events from a turn execution, catching errors as events. */
async function consumeTurn(
  coordinator: ConversationCoordinator,
  input: string,
): Promise<any[]> {
  const events: any[] = [];
  try {
    for await (const event of coordinator.executeTurn(input)) {
      events.push(event);
    }
  } catch (err) {
    events.push({ type: "error", error: err });
  }
  return events;
}

/** Verify no orphaned meta: every .meta.json must have a .jsonl with ≥ 1 turn. */
async function assertNoOrphanedMeta(
  dir: string,
  sessionManager: SessionManager,
): Promise<void> {
  const files = await fs.readdir(dir);
  const metaFiles = files.filter((f) => f.endsWith(".meta.json"));
  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

  // Every meta file must have a corresponding jsonl
  for (const mf of metaFiles) {
    const sessionId = mf.replace(".meta.json", "");
    const expectedJsonl = `${sessionId}.jsonl`;
    expect(
      jsonlFiles.includes(expectedJsonl),
      `meta ${mf} should have corresponding ${expectedJsonl}`,
    ).toBe(true);
  }

  // No sessions with 0 turns
  const sessions = await sessionManager.listSessions();
  for (const s of sessions) {
    expect(
      s.turnCount,
      `session ${s.id} should have > 0 turns`,
    ).toBeGreaterThan(0);
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("ConversationCoordinator", () => {
  let tmpDir: string;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `babyAgent-coord-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    sessionManager = new SessionManager(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ====================================================================
  // Fix 1: tool throws → agent catches it → turn saved normally
  // ====================================================================

  it("should save turn when tool throws (agent catches exception)", async () => {
    const throwingTool: Tool = {
      name: "crashing_tool",
      description: "A tool that always throws",
      parameters: {
        type: "object",
        properties: {
          input: { type: "string", description: "any input" },
        },
        required: ["input"],
      },
      async execute(_params: Record<string, any>): Promise<ToolResult> {
        throw new Error("BOOM — tool crashed!");
      },
    };

    const mockLLM = createMockLLMWithToolCall("crashing_tool", {
      input: "test",
    });

    const agent = new Agent({
      llm: mockLLM,
      tools: [throwingTool],
    });

    const coordinator = new ConversationCoordinator({
      agent,
      sessionManager,
    });

    const events = await consumeTurn(coordinator, "Hello, crash me!");

    // Tool should have reported error (not thrown)
    const toolResultEvent = events.find((e: any) => e.type === "tool_result");
    expect(toolResultEvent).toBeDefined();
    expect(toolResultEvent.result.success).toBe(false);
    expect(toolResultEvent.result.error).toContain("BOOM");

    // Turn should complete normally (done event)
    const doneEvent = events.find((e: any) => e.type === "done");
    expect(doneEvent).toBeDefined();

    // No orphaned meta
    await assertNoOrphanedMeta(tmpDir, sessionManager);
  });

  // ====================================================================
  // Fix 2: LLM throws → coordinator saves error turn (safety net)
  // ====================================================================

  it("should save error turn when LLM throws (coordinator safety net)", async () => {
    const mockLLM = createThrowingMockLLM(
      "LLM API error: 500 Internal Server Error",
    );

    const agent = new Agent({
      llm: mockLLM,
      tools: [],
    });

    const coordinator = new ConversationCoordinator({
      agent,
      sessionManager,
    });

    const events = await consumeTurn(coordinator, "Hello!");

    // Should get agent_error event (not raw error)
    const agentErrorEvent = events.find((e: any) => e.type === "agent_error");
    expect(agentErrorEvent).toBeDefined();
    expect(agentErrorEvent.error).toContain("LLM API error");

    // No orphaned meta — error turn was saved
    await assertNoOrphanedMeta(tmpDir, sessionManager);

    // Verify the saved turn contains error info
    const sessions = await sessionManager.listSessions();
    expect(sessions.length).toBe(1);
    const messages = await sessionManager.loadMessages(sessions[0].id);
    expect(messages.length).toBeGreaterThan(0);
    const assistantMsg = messages.find((m: any) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content).toContain("Agent error");
  });

  // ====================================================================
  // Token usage accumulation
  // ====================================================================

  it("should accumulate token usage from LLM response", async () => {
    // Mock LLM that returns usage data
    const mockLLM: LLMClient = {
      async *chatStream(): AsyncGenerator<LLMStreamChunk> {
        yield {
          delta: { content: "Hello!" },
          finish_reason: "stop",
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
            prompt_cache_hit_tokens: 50,
            prompt_cache_miss_tokens: 50,
            completion_tokens_details: {
              reasoning_tokens: 10,
            },
          },
          accumulated: {
            content: "Hello!",
            tool_calls: undefined,
            finish_reason: "stop",
          },
        };
      },
      switchModel: () => {},
      currentModelId: "mock-model",
    };

    const agent = new Agent({ llm: mockLLM, tools: [] });
    const coordinator = new ConversationCoordinator({
      agent,
      sessionManager,
    });

    // Execute a turn
    const events = await consumeTurn(coordinator, "Hello!");
    const doneEvent = events.find((e: any) => e.type === "done");
    expect(doneEvent).toBeDefined();
    expect(doneEvent.result.success).toBe(true);

    // Verify usage is accumulated
    expect(coordinator.sessionUsage).not.toBeNull();
    expect(coordinator.sessionUsage!.prompt_tokens).toBe(100);
    expect(coordinator.sessionUsage!.completion_tokens).toBe(20);
    expect(coordinator.sessionUsage!.total_tokens).toBe(120);
    expect(coordinator.sessionUsage!.prompt_cache_hit_tokens).toBe(50);
    expect(
      coordinator.sessionUsage!.completion_tokens_details?.reasoning_tokens,
    ).toBe(10);

    // Verify billing is computed
    expect(coordinator.sessionBilling).toBeNull(); // No models configured
  });

  it("should show null usage when LLM returns no usage data", async () => {
    // Mock LLM that does NOT return usage data
    const mockLLM: LLMClient = {
      async *chatStream(): AsyncGenerator<LLMStreamChunk> {
        yield {
          delta: { content: "Hello!" },
          finish_reason: "stop",
          accumulated: {
            content: "Hello!",
            tool_calls: undefined,
            finish_reason: "stop",
            // No usage field
          },
        };
      },
      switchModel: () => {},
      currentModelId: "mock-model",
    };

    const agent = new Agent({ llm: mockLLM, tools: [] });
    const coordinator = new ConversationCoordinator({
      agent,
      sessionManager,
    });

    // Execute a turn
    const events = await consumeTurn(coordinator, "Hello!");
    const doneEvent = events.find((e: any) => e.type === "done");
    expect(doneEvent).toBeDefined();

    // Usage should be null
    expect(coordinator.sessionUsage).toBeNull();
    expect(coordinator.sessionBilling).toBeNull();
  });

  // ====================================================================
  // Normal flow: turn saved correctly
  // ====================================================================

  it("should save turn correctly when tool executes normally", async () => {
    const normalTool: Tool = {
      name: "normal_tool",
      description: "A normal tool that works",
      parameters: {
        type: "object",
        properties: {
          input: { type: "string", description: "any input" },
        },
        required: ["input"],
      },
      async execute(_params: Record<string, any>): Promise<ToolResult> {
        return { success: true, output: "Tool worked!" };
      },
    };

    const mockLLM = createMockLLMWithToolCall("normal_tool", { input: "test" });

    const agent = new Agent({
      llm: mockLLM,
      tools: [normalTool],
    });

    const coordinator = new ConversationCoordinator({
      agent,
      sessionManager,
    });

    const events = await consumeTurn(coordinator, "Hello, use tool!");

    const hasError = events.some((e: any) => e.type === "error");
    expect(hasError).toBe(false);

    await assertNoOrphanedMeta(tmpDir, sessionManager);
  });
});
