/**
 * AppFactory — creates and wires all CLI dependencies in the right order.
 *
 * Isolates the construction logic so the entry point (cli.ts) stays thin
 * and the component wiring is explicit and testable.
 */
import { Agent } from "../agent.js";
import { SessionManager } from "../session.js";
import { ConversationCoordinator } from "../coordinator.js";
import { ChatClient } from "../llm/index.js";
import {
  loadModelConfig,
  getAllModels,
  type ModelEntry,
} from "../llm/models.js";
import { createBashToolAsTool } from "../tools/bash/index.js";
import { createAllFsTools } from "../tools/fs/index.js";
import { McpManager, type ServerStatus } from "../mcp/index.js";
import type { Tool } from "../tools/interface/index.js";
import { SkillManager } from "../skills.js";
import { loadSystemPrompt, getSystemPromptPath } from "../llm/prompt.js";

// ============================================================================
// Types
// ============================================================================

export interface AppComponents {
  coordinator: ConversationCoordinator;
  mcpManager: McpManager;
  skillManager: SkillManager;
  tools: readonly Tool[];
  mcpStatuses: readonly ServerStatus[];
  /** List of available models from the config, for UI switching. */
  models: ModelEntry[];
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create and wire all CLI dependencies.
 *
 * Reads provider config from ~/.babyAgent/models.json, loads MCP tools,
 * discovers skills, creates the agent and coordinator, and returns
 * all components ready for the app loop.
 */
export async function createApp(): Promise<AppComponents> {
  // ------------------------------------------------------------------
  // Model config — single source of truth for LLM connectivity
  // ------------------------------------------------------------------
  const modelConfig = await loadModelConfig();
  const allModels = getAllModels(modelConfig);
  const cwd = process.cwd();

  // ------------------------------------------------------------------
  // Tools
  // ------------------------------------------------------------------
  const bashTool = createBashToolAsTool(cwd);
  const fsTools = createAllFsTools(cwd);

  // ------------------------------------------------------------------
  // MCP
  // ------------------------------------------------------------------
  const mcpManager = new McpManager();
  let mcpTools: Tool[] = [];
  try {
    mcpTools = await mcpManager.loadAllTools();
  } catch (err) {
    console.log(
      `[MCP] Failed to load MCP config: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const mcpStatuses: ServerStatus[] = mcpManager.getServerStatuses();

  // Warn about failed servers
  for (const s of mcpStatuses) {
    if (!s.ok) {
      console.log(`[MCP] ${s.name}: ${s.error}`);
    }
  }

  // Build the full tool list
  const allTools: Tool[] = [bashTool, ...fsTools, ...mcpTools];

  // ------------------------------------------------------------------
  // Skills
  // ------------------------------------------------------------------
  const skillManager = new SkillManager();
  await skillManager.loadSkills();

  // ------------------------------------------------------------------
  // System prompt
  // ------------------------------------------------------------------
  let systemPrompt: string;
  try {
    systemPrompt = await loadSystemPrompt();
    console.log(`System prompt loaded from ${getSystemPromptPath()}`);
  } catch (err) {
    console.error(
      `[System Prompt] ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err; // Fail fast like models.json
  }
  const skillsPrompt = skillManager.formatSkillsForSystemPrompt();
  if (skillsPrompt) {
    systemPrompt += "\n\n" + skillsPrompt;
  }

  // ------------------------------------------------------------------
  // Agent + Coordinator
  // ------------------------------------------------------------------
  const agent = new Agent({
    llm: new ChatClient(allModels),
    tools: allTools,
    systemPrompt,
  });

  const coordinator = new ConversationCoordinator({
    agent,
    sessionManager: new SessionManager(),
  });

  // ------------------------------------------------------------------
  // Return all components
  // ------------------------------------------------------------------
  return {
    coordinator,
    mcpManager,
    skillManager,
    tools: allTools,
    mcpStatuses,
    models: allModels,
  };
}
