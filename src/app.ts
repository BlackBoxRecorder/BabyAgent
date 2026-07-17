/**
 * AppFactory — creates and wires all CLI dependencies in the right order.
 *
 * Isolates the construction logic so the entry point (cli.ts) stays thin
 * and the component wiring is explicit and testable.
 */
import { Agent } from "./agent.js";
import { SessionManager } from "./session.js";
import { ConversationCoordinator } from "./coordinator.js";
import { ChatClient, DefaultBillingCalculator } from "./llm/index.js";
import { loadModelConfig, getAllModels } from "./llm/models.js";
import { createBashToolAsTool } from "./tools/bash/index.js";
import { createAllFsTools } from "./tools/fs/index.js";
import { McpManager, type ServerStatus } from "./mcp/index.js";
import { DefaultToolRegistry, type Tool } from "./tools/interface/index.js";
import { SkillManager } from "./skills.js";
import { createSkillTool } from "./tools/skill/index.js";
import { loadSystemPrompt, getSystemPromptPath } from "./llm/prompt.js";
import { getLogger } from "./logger.js";
import { DefaultCommandHandler } from "./tui/command.js";
import type { CommandHandler } from "./tui/command.js";

// ============================================================================
// Types
// ============================================================================

export interface AppComponents {
  coordinator: ConversationCoordinator;
  mcpManager: McpManager;
  skillManager: SkillManager;
  tools: readonly Tool[];
  mcpStatuses: readonly ServerStatus[];
  /** Command handler for slash commands. */
  commandHandler: CommandHandler;
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
  // Skills
  // ------------------------------------------------------------------
  const skillManager = new SkillManager();
  await skillManager.loadSkills();

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

  // ------------------------------------------------------------------
  // Skill meta-tool (Claude Code pattern)
  // ------------------------------------------------------------------
  const skillTool = createSkillTool(skillManager);

  // Build the full tool list (Skill tool is listed last so model sees
  // domain tools first).
  const allTools: Tool[] = [bashTool, ...fsTools, ...mcpTools, skillTool];

  // Create tool registry and register all tools
  const toolRegistry = new DefaultToolRegistry();
  for (const tool of allTools) {
    toolRegistry.register(tool);
  }

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
  // Skills are now registered as a dedicated Skill meta-tool,
  // not appended to the system prompt. See tools/skill/tool.ts.

  // ------------------------------------------------------------------
  // Logger
  // ------------------------------------------------------------------
  const logger = getLogger();

  // ------------------------------------------------------------------
  // Billing calculator
  // ------------------------------------------------------------------
  const billingCalculator = new DefaultBillingCalculator();

  // ------------------------------------------------------------------
  // Agent + Coordinator
  // ------------------------------------------------------------------
  const agent = new Agent({
    llm: new ChatClient(allModels, billingCalculator),
    toolRegistry,
    systemPrompt,
    logger,
  });

  const coordinator = new ConversationCoordinator({
    agent,
    sessionManager: new SessionManager(),
    logger,
  });

  // ------------------------------------------------------------------
  // Command handler
  // ------------------------------------------------------------------
  const commandHandler = new DefaultCommandHandler();

  // ------------------------------------------------------------------
  // Return all components
  // ------------------------------------------------------------------
  return {
    coordinator,
    mcpManager,
    skillManager,
    tools: allTools,
    mcpStatuses,
    commandHandler,
  };
}
