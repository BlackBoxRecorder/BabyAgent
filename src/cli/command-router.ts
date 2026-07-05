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

  /** Return the help text as a string (for TUI display in chat area). */
  getHelpText(): string {
    return [
      "Available commands:",
      "  /help       - Show this help message",
      "  /new        - Start a new session",
      "  /sessions   - List session history",
      "  /continue <id> - Continue a previous session",
      "  /tools      - List available tools",
      "  /skills     - List available skills",
      "  /skill:<name> - Invoke a skill by name",
      "  /mcp        - List MCP server status",
      "  /reset      - Same as /new",
      "  /exit       - Exit the program",
      "",
      "Any other input will be sent to the AI agent.",
    ].join("\n");
  }

  private printHelp(): void {
    this.display.println(this.getHelpText());
  }

  /** Return the tools list as a string (for TUI display in chat area). */
  getToolsText(): string {
    const lines = ["Available tools:"];
    for (const tool of this.tools) {
      lines.push(`  ${tool.name}: ${tool.description}`);
    }
    return lines.join("\n");
  }

  private printTools(): void {
    this.display.println(this.getToolsText());
  }

  /** Return the MCP status as a string (for TUI display in chat area). */
  getMcpStatusText(): string {
    if (this.mcpStatuses.length === 0) {
      return [
        "No MCP servers configured.",
        "Configure servers in ~/.babyAgent/mcp.json",
      ].join("\n");
    }
    const lines = ["MCP servers:"];
    for (const s of this.mcpStatuses) {
      const status = s.ok ? "✓" : "✗";
      const toolInfo = s.ok ? `${s.toolCount} tool(s)` : s.error;
      lines.push(
        `  ${status} ${s.name.padEnd(25)} [${s.transport}]  ${toolInfo}`,
      );
    }
    return lines.join("\n");
  }

  private printMcpStatus(): void {
    this.display.println(this.getMcpStatusText());
  }

  /** Return the skills list as a string (for TUI display in chat area). */
  getSkillsText(): string {
    const skills = this.skillManager.getSkills();
    if (skills.length === 0) {
      return [
        "No skills found.",
        "Place skills in ~/.babyAgent/skills/ or .babyAgent/skills/",
      ].join("\n");
    }
    const lines = ["Available skills:"];
    for (const skill of skills) {
      const tag = skill.disableModelInvocation ? "[manual]" : "[auto]";
      const source = skill.source === "user" ? "user" : "project";
      lines.push(
        `  ${tag} ${skill.name.padEnd(20)} [${source}] ${skill.description}`,
      );
    }
    return lines.join("\n");
  }

  private printSkills(): void {
    this.display.println(this.getSkillsText());
  }

  /** Return the sessions list as a string (for TUI display in chat area). */
  async getSessionsText(): Promise<string> {
    const sessions = await this.coordinator.listSessions();
    if (sessions.length === 0) {
      return "No session history.";
    }
    const lines = ["Session history:"];
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
      lines.push(
        `${marker}${s.id.slice(0, 8)}  [${date}]  ${title}  (${s.turnCount} turns)`,
      );
    }
    return lines.join("\n");
  }

  private async handleSessions(): Promise<void> {
    this.display.println(await this.getSessionsText());
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
