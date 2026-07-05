/**
 * AppFactory — creates and wires all CLI dependencies in the right order.
 *
 * Isolates the construction logic so the entry point (cli.ts) stays thin
 * and the component wiring is explicit and testable.
 */
import { Agent } from "../agent.js";
import { SessionManager } from "../session.js";
import { ConversationCoordinator } from "../coordinator.js";
import { DeepSeekClient } from "../llm/index.js";
import {
  loadModelConfig,
  getDeepSeekProvider,
  type ModelInfo,
} from "../llm/models-config.js";
import { createBashToolAsTool } from "../tools/bash/index.js";
import { createAllFsTools } from "../tools/fs/index.js";
import { McpManager, type ServerStatus } from "../mcp/index.js";
import type { Tool } from "../tools/interface/index.js";
import { SkillManager } from "../skills.js";
import { CommandRouter } from "./command-router.js";
import { DisplayRenderer } from "./display-renderer.js";

// ============================================================================
// Types
// ============================================================================

export interface AppComponents {
  coordinator: ConversationCoordinator;
  commandRouter: CommandRouter;
  display: DisplayRenderer;
  mcpManager: McpManager;
  skillManager: SkillManager;
  /** List of available models from the config, for UI switching. */
  models: ModelInfo[];
  /** The default model ID to display as active on startup. */
  defaultModelId: string;
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
  const deepseekProvider = getDeepSeekProvider(modelConfig);
  const cwd = process.cwd();

  const display = new DisplayRenderer();

  display.println(
    `Provider: deepseek | ${deepseekProvider.models.length} model(s) | ` +
      `default: ${deepseekProvider.defaultModel}`,
  );

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
    display.println(
      `[MCP] Failed to load MCP config: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const mcpStatuses: ServerStatus[] = mcpManager.getServerStatuses();

  // Warn about failed servers
  for (const s of mcpStatuses) {
    if (!s.ok) {
      display.println(`[MCP] ${s.name}: ${s.error}`);
    }
  }

  // Build the full tool list
  const allTools: Tool[] = [bashTool, ...fsTools, ...mcpTools];

  // Startup summary
  const builtinCount = 1 + fsTools.length;
  const okServers = mcpStatuses.filter((s) => s.ok).length;
  if (okServers > 0 || mcpTools.length > 0) {
    display.println(
      `Loaded ${builtinCount} built-in tools + ${mcpTools.length} MCP tool(s) ` +
        `from ${okServers} server(s)`,
    );
  }

  // ------------------------------------------------------------------
  // Skills
  // ------------------------------------------------------------------
  const skillManager = new SkillManager();
  await skillManager.loadSkills();
  const skillCount = skillManager.getSkills().length;
  const visibleSkills = skillManager
    .getSkills()
    .filter((s) => !s.disableModelInvocation);
  if (skillCount > 0) {
    display.println(
      `Loaded ${skillCount} skill(s) (${visibleSkills.length} auto, ${skillCount - visibleSkills.length} manual)`,
    );
  }

  // ------------------------------------------------------------------
  // System prompt
  // ------------------------------------------------------------------
  let systemPrompt =
    "You are a helpful terminal AI agent. You have access to bash commands " +
    "and filesystem tools. When performing tasks, use tools to gather " +
    "information before responding. Be concise and direct.";
  const skillsPrompt = skillManager.formatSkillsForSystemPrompt();
  if (skillsPrompt) {
    systemPrompt += "\n\n" + skillsPrompt;
  }

  // ------------------------------------------------------------------
  // Agent + Coordinator
  // ------------------------------------------------------------------
  const agent = new Agent({
    llm: new DeepSeekClient({
      apiKey: deepseekProvider.apiKey,
      baseUrl: deepseekProvider.baseUrl,
      defaults: { model: deepseekProvider.defaultModel },
    }),
    tools: allTools,
    systemPrompt,
    models: deepseekProvider.models,
    defaultModel: deepseekProvider.defaultModel,
  });

  const coordinator = new ConversationCoordinator({
    agent,
    sessionManager: new SessionManager(),
  });

  // ------------------------------------------------------------------
  // Command router
  // ------------------------------------------------------------------
  const commandRouter = new CommandRouter(
    coordinator,
    allTools,
    mcpStatuses,
    skillManager,
    display,
  );

  return {
    coordinator,
    commandRouter,
    display,
    mcpManager,
    skillManager,
    models: deepseekProvider.models,
    defaultModelId: deepseekProvider.defaultModel!,
  };
}
