/**
 * DefaultCommandHandler — implements the CommandHandler interface.
 *
 * Handles all slash commands: /help, /tools, /mcp, /new, /reset,
 * /exit, /quit, /q, /skill:<name>, /sessions.
 *
 * @module default-command-handler
 */
import type { ConversationCoordinator } from "../coordinator.js";
import type { SkillManager } from "../skills.js";
import type { McpManager, ServerStatus } from "../mcp/index.js";
import type { Tool } from "../tools/interface/index.js";

// ============================================================================
// Types
// ============================================================================

/** Result of handling a slash command. */
export type CommandResult =
  /** Display text to the user. */
  | { type: "display"; text: string }
  /** Execute an async action (e.g., shutdown). */
  | { type: "action"; action: () => Promise<void> }
  /** Send input to the LLM as a turn. */
  | { type: "turn"; input: string }
  /** Command not recognized. */
  | { type: "unknown" }
  /** No-op (e.g., /sessions with autocomplete). */
  | { type: "noop" };

/** Context passed to the command handler. */
export interface CommandContext {
  coordinator: ConversationCoordinator;
  skillManager: SkillManager;
  tools: readonly Tool[];
  mcpStatuses: readonly ServerStatus[];
  mcpManager: McpManager;
}

/** Command handler interface for dependency injection. */
export interface CommandHandler {
  handle(input: string, context: CommandContext): Promise<CommandResult>;
}

// ============================================================================
// DefaultCommandHandler
// ============================================================================

export class DefaultCommandHandler implements CommandHandler {
  async handle(input: string, context: CommandContext): Promise<CommandResult> {
    // /help
    if (input === "/help") {
      return { type: "display", text: this._getHelpText() };
    }

    // /tools
    if (input === "/tools") {
      return { type: "display", text: this._getToolsText(context) };
    }

    // /mcp
    if (input === "/mcp") {
      return { type: "display", text: this._getMcpStatusText(context) };
    }

    // /sessions — no-op, handled by autocomplete
    if (input === "/sessions") {
      return { type: "noop" };
    }

    // /skill — no-op, handled by autocomplete
    if (input === "/skill") {
      return { type: "noop" };
    }

    // /new, /reset
    if (input === "/new" || input === "/reset") {
      context.coordinator.newSession();
      return { type: "display", text: "Started new session." };
    }

    // /exit, /quit, /q
    if (input === "/exit" || input === "/quit" || input === "/q") {
      return {
        type: "action",
        action: async () => {
          await context.mcpManager.dispose();
          process.exit(0);
        },
      };
    }

    // Unknown command
    return {
      type: "display",
      text: `Unknown command: ${input}\nType /help to see available commands.`,
    };
  }

  // ==========================================================================
  // Text generators
  // ==========================================================================

  private _getHelpText(): string {
    return [
      "Available commands:",
      "  /help           - Show this help message",
      "  /new            - Start a new session",
      "  /sessions       - List session history",
      "  /tools          - List available tools",
      "  /skill:<name>   - Invoke a skill by name",
      "  /mcp            - List MCP server status",
      "  /reset          - Same as /new",
      "  /q              - Exit the program",
      "",
      "Any other input will be sent to the AI agent.",
    ].join("\n");
  }

  private _getToolsText(context: CommandContext): string {
    const lines = ["Available tools:"];
    for (const tool of context.tools) {
      lines.push(`  ${tool.name}: ${tool.description}`);
    }
    return lines.join("\n");
  }

  private _getMcpStatusText(context: CommandContext): string {
    if (context.mcpStatuses.length === 0) {
      return [
        "No MCP servers configured.",
        "Configure servers in ~/.babyAgent/mcp.json",
      ].join("\n");
    }
    const lines = ["MCP servers:"];
    for (const s of context.mcpStatuses) {
      const status = s.ok ? "✓" : "✗";
      const toolInfo = s.ok ? `${s.toolCount} tool(s)` : s.error;
      lines.push(
        `  ${status} ${s.name.padEnd(25)} [${s.transport}]  ${toolInfo}`,
      );
    }
    return lines.join("\n");
  }
}
