/**
 * CommandRouter — parses and dispatches slash-commands entered by the user.
 *
 * Owns the rendering of command output (help, tool lists, session history, etc.)
 * and returns a structured result so the app loop knows whether to continue
 * with a chat turn or exit.
 */
import type { Tool } from "../tools/interface/index.js";
import type { ConversationCoordinator } from "../coordinator.js";
import type { SkillManager } from "../skills.js";
import type { ServerStatus } from "../mcp/index.js";
import { DisplayRenderer } from "./display-renderer.js";

// ============================================================================
// Types
// ============================================================================

export type CommandResult =
  | { type: "handled" }
  | { type: "chat"; input: string }
  | { type: "exit" };

// ============================================================================
// CommandRouter
// ============================================================================

export class CommandRouter {
  constructor(
    private coordinator: ConversationCoordinator,
    private tools: readonly Tool[],
    private mcpStatuses: readonly ServerStatus[],
    private skillManager: SkillManager,
    private display: DisplayRenderer,
  ) {}

  /**
   * Parse a line of user input and dispatch to the appropriate handler.
   * Returns a CommandResult telling the app loop what to do next.
   */
  async route(input: string): Promise<CommandResult> {
    const cmd = input.trim();

    // /continue <session-id>
    if (cmd.startsWith("/continue ")) {
      const sessionId = cmd.slice("/continue ".length).trim();
      if (!sessionId) {
        this.display.println("Usage: /continue <session-id>");
        return { type: "handled" };
      }
      await this.handleContinue(sessionId);
      return { type: "handled" };
    }

    switch (cmd) {
      case "/help":
        this.printHelp();
        return { type: "handled" };
      case "/tools":
        this.printTools();
        return { type: "handled" };
      case "/skills":
        this.printSkills();
        return { type: "handled" };
      case "/mcp":
        this.printMcpStatus();
        return { type: "handled" };
      case "/exit":
        this.display.println("Goodbye!");
        return { type: "exit" };
      case "/new":
      case "/reset":
        this.handleNew();
        return { type: "handled" };
      case "/sessions":
        await this.handleSessions();
        return { type: "handled" };
      default:
        if (cmd.startsWith("/skill:")) {
          return this.handleSkillCommand(cmd);
        }
        this.display.println(`Unknown command: ${cmd}`);
        this.display.println("Type /help to see available commands.");
        return { type: "handled" };
    }
  }

  // ==========================================================================
  // Command handlers
  // ==========================================================================

  private printHelp(): void {
    this.display.println("Available commands:");
    this.display.println("  /help       - Show this help message");
    this.display.println("  /new        - Start a new session");
    this.display.println("  /sessions   - List session history");
    this.display.println("  /continue <id> - Continue a previous session");
    this.display.println("  /tools      - List available tools");
    this.display.println("  /skills     - List available skills");
    this.display.println("  /skill:<name> - Invoke a skill by name");
    this.display.println("  /mcp        - List MCP server status");
    this.display.println("  /reset      - Same as /new");
    this.display.println("  /exit       - Exit the program");
    this.display.println("");
    this.display.println("Any other input will be sent to the AI agent.");
  }

  private printTools(): void {
    this.display.println("Available tools:");
    for (const tool of this.tools) {
      this.display.println(`  ${tool.name}: ${tool.description}`);
    }
  }

  private printMcpStatus(): void {
    if (this.mcpStatuses.length === 0) {
      this.display.println("No MCP servers configured.");
      this.display.println("Configure servers in ~/.deepcode/mcp.json");
      return;
    }
    this.display.println("MCP servers:");
    for (const s of this.mcpStatuses) {
      const status = s.ok ? "✓" : "✗";
      const toolInfo = s.ok ? `${s.toolCount} tool(s)` : s.error;
      this.display.println(
        `  ${status} ${s.name.padEnd(25)} [${s.transport}]  ${toolInfo}`,
      );
    }
  }

  private printSkills(): void {
    const skills = this.skillManager.getSkills();
    if (skills.length === 0) {
      this.display.println("No skills found.");
      this.display.println(
        "Place skills in ~/.deepcode/skills/ or .deepcode/skills/",
      );
      return;
    }
    this.display.println("Available skills:");
    for (const skill of skills) {
      const tag = skill.disableModelInvocation ? "[manual]" : "[auto]";
      const source = skill.source === "user" ? "user" : "project";
      this.display.println(
        `  ${tag} ${skill.name.padEnd(20)} [${source}] ${skill.description}`,
      );
    }
  }

  private async handleSessions(): Promise<void> {
    const sessions = await this.coordinator.listSessions();
    if (sessions.length === 0) {
      this.display.println("No session history.");
      return;
    }
    this.display.println("Session history:");
    const currentId = this.coordinator.currentSessionId;
    for (const s of sessions) {
      const marker = s.id === currentId ? "* " : "  ";
      const date = new Date(s.createdAt).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const title = s.title.padEnd(40, " ");
      this.display.println(
        `${marker}${s.id.slice(0, 8)}  [${date}]  ${title}  (${s.turnCount} turns)`,
      );
    }
  }

  private async handleContinue(sessionId: string): Promise<void> {
    try {
      const meta = await this.coordinator.resumeSession(sessionId);
      this.display.println(
        `Switched to session ${sessionId.slice(0, 8)}: ${meta.title}`,
      );
    } catch (err) {
      this.display.println(
        err instanceof Error ? err.message : "Session not found.",
      );
    }
  }

  private handleNew(): void {
    this.coordinator.newSession();
    this.display.println("New session started.");
  }

  private async handleSkillCommand(cmd: string): Promise<CommandResult> {
    // Parse: /skill:<name> [additional instructions]
    const rest = cmd.slice("/skill:".length).trim();
    if (!rest) {
      this.display.println("Usage: /skill:<name> [additional instructions]");
      return { type: "handled" };
    }

    // Extract name (first word before space, or entire string)
    const spaceIdx = rest.indexOf(" ");
    const skillName = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
    const additional = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1).trim();

    const skill = this.skillManager.getSkill(skillName);
    if (!skill) {
      this.display.println(`Skill not found: ${skillName}`);
      this.display.println("Use /skills to list available skills.");
      return { type: "handled" };
    }

    // Read and format skill content
    let content: string;
    try {
      content = await this.skillManager.readSkillContent(skillName);
    } catch (err) {
      this.display.println(
        `Failed to read skill: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { type: "handled" };
    }

    const skillDir = skill.location.replace(/[/\\]SKILL\.md$/, "");
    const expanded = [
      `<skill name="${skillName}" location="${skill.location}">`,
      `References are relative to ${skillDir}.`,
      "",
      content,
      "</skill>",
    ];
    if (additional) {
      expanded.push("", additional);
    }

    this.display.println(`[Activated skill: ${skillName}]`);
    return { type: "chat", input: expanded.join("\n") };
  }
}
