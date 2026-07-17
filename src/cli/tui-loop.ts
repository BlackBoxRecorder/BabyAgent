/**
 * TuiLoop — the pi-tui-driven chat interface that replaces the readline REPL.
 *
 * Provides markdown rendering, multi-line input with autocomplete, keyboard
 * shortcuts, session history browsing via SelectList overlay, and flicker-free
 * streaming output through pi-tui's differential rendering.
 */
import {
  TUI,
  ProcessTerminal,
  Container,
  Editor,
  Markdown,
  Text,
  Loader,
  Spacer,
  CombinedAutocompleteProvider,
  matchesKey,
  Key,
  isKeyRelease,
  type EditorTheme,
  type MarkdownTheme,
} from "@earendil-works/pi-tui";
import type { ConversationCoordinator } from "../coordinator.js";
import type { McpManager, ServerStatus } from "../mcp/index.js";
import type { Tool } from "../tools/interface/index.js";
import type { SkillManager } from "../skills.js";
import { SessionAutocompleteProvider } from "./session-autocomplete.js";
import { SkillAutocompleteProvider } from "./skill-autocomplete.js";
import type { ExecuteTurnOptions } from "../coordinator.js";
import type {
  CommandHandler,
  CommandContext,
  CommandResult,
} from "./command.js";

// ============================================================================
// ANSI Style Helpers (no external dependency needed)
// ============================================================================

const ansi = {
  dim: (s: string): string => `\x1b[2m${s}\x1b[22m`,
  bold: (s: string): string => `\x1b[1m${s}\x1b[22m`,
  italic: (s: string): string => `\x1b[3m${s}\x1b[23m`,
  underline: (s: string): string => `\x1b[4m${s}\x1b[24m`,
  strikethrough: (s: string): string => `\x1b[9m${s}\x1b[29m`,
  red: (s: string): string => `\x1b[31m${s}\x1b[39m`,
  green: (s: string): string => `\x1b[32m${s}\x1b[39m`,
  yellow: (s: string): string => `\x1b[33m${s}\x1b[39m`,
  blue: (s: string): string => `\x1b[34m${s}\x1b[39m`,
  magenta: (s: string): string => `\x1b[35m${s}\x1b[39m`,
  cyan: (s: string): string => `\x1b[36m${s}\x1b[39m`,
  white: (s: string): string => `\x1b[37m${s}\x1b[39m`,
  gray: (s: string): string => `\x1b[90m${s}\x1b[39m`,
  bgGray: (s: string): string => `\x1b[100m${s}\x1b[49m`,
  bgBlue: (s: string): string => `\x1b[44m${s}\x1b[49m`,
  bgGreen: (s: string): string => `\x1b[42m${s}\x1b[49m`,
};

// ============================================================================
// Themes
// ============================================================================

const editorTheme: EditorTheme = {
  borderColor: ansi.gray,
  selectList: {
    selectedPrefix: ansi.cyan,
    selectedText: ansi.bold,
    description: ansi.gray,
    scrollInfo: ansi.gray,
    noMatch: ansi.gray,
  },
};

/** Markdown rendering theme — applies ANSI color styles for rich display. */
const markdownTheme: MarkdownTheme = {
  heading: (s) => ansi.bold(ansi.cyan(s)),
  link: (s) => ansi.underline(ansi.blue(s)),
  linkUrl: ansi.gray,
  code: (s) => ansi.green(s),
  codeBlock: ansi.green,
  codeBlockBorder: ansi.gray,
  quote: ansi.yellow,
  quoteBorder: ansi.gray,
  hr: ansi.gray,
  listBullet: ansi.gray,
  bold: ansi.bold,
  italic: ansi.italic,
  strikethrough: ansi.strikethrough,
  underline: ansi.underline,
};

/** Default text style for assistant Markdown messages. */
const assistantDefaultStyle: import("@earendil-works/pi-tui").DefaultTextStyle =
  {
    color: ansi.white,
  };

// ============================================================================
// TuiLoop
// ============================================================================

export class TuiLoop {
  private coordinator: ConversationCoordinator;
  private skillManager: SkillManager;
  private tools: readonly Tool[];
  private mcpStatuses: readonly ServerStatus[];
  private mcpManager: McpManager;
  private commandHandler: CommandHandler;
  private commandContext: CommandContext;
  private tui: TUI;
  private editor: Editor;
  private messagesContainer: Container;
  /** Status bar showing current session ID and shortcut hints. */
  private statusBar!: Text;
  /** Reference to the current streaming Markdown component, if any. */
  private streamingMd: Markdown | null = null;
  /** Accumulated text for the current streaming Markdown component. */
  private streamingText = "";
  /** Reference to the thinking display Text component, if any. */
  private thinkingText: Text | null = null;
  /** Accumulated reasoning_content text. */
  private thinkingContent = "";
  private isProcessing = false;
  private loader: Loader;
  /** Abort controller for cancelling in-flight agent turn. */
  private abortController: AbortController | null = null;

  /** Currently active model ID. */
  private currentModelId: string;
  /** Info bar at the bottom: model name, token usage, cost. */
  private infoBar: Text;
  /** Temporary turn-level usage for real-time display during streaming. */
  private turnUsage: {
    prompt: number;
    completion: number;
    total: number;
  } | null = null;

  constructor(
    coordinator: ConversationCoordinator,
    skillManager: SkillManager,
    tools: readonly Tool[],
    mcpStatuses: readonly ServerStatus[],
    mcpManager: McpManager,
    commandHandler: CommandHandler,
  ) {
    this.coordinator = coordinator;
    this.skillManager = skillManager;
    this.tools = tools;
    this.mcpStatuses = mcpStatuses;
    this.mcpManager = mcpManager;
    this.commandHandler = commandHandler;
    this.commandContext = {
      coordinator,
      skillManager,
      tools,
      mcpStatuses,
      mcpManager,
    };
    this.currentModelId = this.coordinator.currentModel ?? "";

    // Create terminal and TUI
    const terminal = new ProcessTerminal();
    this.tui = new TUI(terminal);

    // Status bar at the top: session ID + shortcut hints
    this.statusBar = new Text(this._buildStatusText(), 0, 0);
    this.tui.addChild(this.statusBar);

    // Messages container
    this.messagesContainer = new Container();
    this.tui.addChild(this.messagesContainer);

    // Editor
    this.editor = new Editor(this.tui, editorTheme, { paddingX: 0 });
    this.editor.onSubmit = (text: string) => this.handleSubmit(text);

    // Set up autocomplete with slash commands
    const baseProvider = new CombinedAutocompleteProvider(
      [
        { name: "help", description: "Show help message" },
        { name: "new", description: "Start a new session (or Ctrl+N)" },
        { name: "sessions", description: "List session history" },
        { name: "tools", description: "List available tools" },
        { name: "skill", description: "Invoke a skill by name" },
        { name: "mcp", description: "List MCP server status" },
        { name: "remember", description: "Remember a user preference" },
        { name: "exit", description: "Exit the program" },
        { name: "q", description: "Exit the program" },
        { name: "quit", description: "Exit the program" },
      ],
      process.cwd(),
    );
    const sessionProvider = new SessionAutocompleteProvider(
      baseProvider,
      this.coordinator,
      {
        onSessionSelect: (sessionId) => this.handleSessionSelect(sessionId),
      },
    );
    const skillProvider = new SkillAutocompleteProvider(
      this.skillManager,
      sessionProvider,
    );
    this.editor.setAutocompleteProvider(skillProvider);

    this.tui.addChild(this.editor);

    // Info bar at the very bottom: model + session token/cost stats
    this.infoBar = new Text(this._buildInfoBarText(), 0, 0);
    this.tui.addChild(this.infoBar);

    // Focus the editor
    this.tui.setFocus(this.editor);

    // Loading indicator (hidden by default, added to TUI only when active)
    this.loader = new Loader(this.tui, ansi.cyan, ansi.gray, "");

    // Ctrl+C to exit
    this.tui.addInputListener((data) => {
      // Ignore key release events (Kitty keyboard protocol sends
      // separate press/release events; matching both would double-fire)
      if (isKeyRelease(data)) return undefined;

      if (matchesKey(data, Key.ctrl("c"))) {
        this.shutdown();
        return { consume: true };
      }
      // Esc: abort streaming response
      if (matchesKey(data, Key.escape)) {
        if (this.isProcessing && this.abortController) {
          this.abortController.abort();
        }
        return { consume: true };
      }
      // Ctrl+H: removed as per user request
      // Ctrl+N: new session
      if (matchesKey(data, Key.ctrl("n"))) {
        this.handleNewSession();
        return { consume: true };
      }
      // Ctrl+P: cycle to next model
      if (matchesKey(data, Key.ctrl("p"))) {
        this.cycleModel();
        return { consume: true };
      }
      return undefined;
    });
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /** Start the TUI. Blocks until the user exits. */
  start(): void {
    this.addMessage(new Text("babyAgent - Terminal AI Agent", 0, 0));
    this.addMessage(
      new Text("Type /help for commands, or just ask a question.", 0, 0),
    );

    // Startup info: tools, MCP servers, skills
    const toolNames = this.tools.map((t) => t.name).join(", ");
    const skillNames = this.skillManager
      .getSkills()
      .map((s) => s.name)
      .join(", ");
    this.addMessage(new Text(`Tools: ${toolNames}`, 0, 0));

    this.addMessage(
      new Text(`${skillNames ? `Skills: ${skillNames}` : ""}`, 0, 0),
    );

    if (this.mcpStatuses.length > 0) {
      const mcpLine = this.mcpStatuses
        .map((s) => `${s.ok ? ansi.green("✓") : ansi.red("✗")} ${s.name}`)
        .join(", ");
      this.addMessage(new Text(`MCP: ${mcpLine}`, 0, 0));
    }

    this.tui.start();
  }

  /** Stop the TUI and clean up. */
  private async shutdown(): Promise<void> {
    this.tui.stop();
    await this.mcpManager.dispose();
    process.exit(0);
  }

  // ==========================================================================
  // Message helpers (add components directly to container)
  // ==========================================================================

  /** Add a component to the message container and trigger a render. */
  private addMessage(comp: Markdown | Text | Spacer): void {
    this.messagesContainer.addChild(comp);
    this.tui.requestRender();
  }

  /** Clear all messages from the container. */
  private clearMessages(): void {
    this.streamingMd = null;
    this.streamingText = "";
    this.thinkingText = null;
    this.thinkingContent = "";
    this.messagesContainer.clear();
  }

  // ==========================================================================
  // Input handling
  // ==========================================================================

  private async handleSubmit(text: string): Promise<void> {
    const input = text.trim();
    if (!input || this.isProcessing) return;

    this.isProcessing = true;

    // Add to editor history for up/down arrow navigation
    this.editor.addToHistory(text);

    try {
      if (input.startsWith("/")) {
        const result = await this.commandHandler.handle(
          input,
          this.commandContext,
        );
        await this._handleCommandResult(result);
      } else {
        await this.handleChatTurn(input);
      }
    } catch (err) {
      this.addMessage(
        new Text(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
          0,
          0,
        ),
      );
    } finally {
      this.isProcessing = false;
    }
  }

  // ==========================================================================
  // Command result handling
  // ==========================================================================

  private async _handleCommandResult(result: CommandResult): Promise<void> {
    switch (result.type) {
      case "display":
        this.addMessage(new Text(result.text, 0, 0));
        // If this was a /new or /reset command, also reset the UI
        if (result.text === "Started new session.") {
          this.handleNewSession();
        }
        break;
      case "action":
        await result.action();
        break;
      case "turn":
        this.addMessage(new Text("[Activated skill]", 0, 0));
        await this.executeTurn(result.input);
        break;
      case "noop":
        // Do nothing
        break;
      case "unknown":
        this.addMessage(
          new Text(
            "Unknown command. Type /help to see available commands.",
            0,
            0,
          ),
        );
        break;
    }
  }

  // ==========================================================================
  // Chat turn
  // ==========================================================================

  private async handleChatTurn(input: string): Promise<void> {
    // Show user message with visual distinction (cyan prompt, dim text)
    this.addMessage(
      new Text(
        `${ansi.cyan("You")} ${ansi.dim(">")} ${input}`,
        0,
        0,
        ansi.bgGray,
      ),
    );
    await this.executeTurn(input);
  }

  private async executeTurn(input: string): Promise<void> {
    // Create abort controller for this turn
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Show loading indicator
    this.loader.setMessage("Thinking...");
    this.loader.start();
    this.tui.addChild(this.loader);
    this.tui.requestRender();

    // Reset streaming state for this turn
    this.streamingText = "";
    this.streamingMd = null;
    this.thinkingContent = "";
    this.thinkingText = null;

    let totalToolCalls = 0;

    /** Ensure a streaming Markdown component exists, creating one if needed. */
    const ensureMd = (): Markdown => {
      if (!this.streamingMd) {
        this.streamingText = "";
        this.streamingMd = new Markdown(
          "",
          1,
          0,
          markdownTheme,
          assistantDefaultStyle,
        );
        this.addMessage(this.streamingMd);
      }
      return this.streamingMd;
    };

    try {
      const options: ExecuteTurnOptions = { signal };
      for await (const event of this.coordinator.executeTurn(input, options)) {
        switch (event.type) {
          case "session_created":
            this.updateStatusBar();
            break;

          case "chunk": {
            const { delta } = event.chunk;

            // Handle reasoning_content — display dimmed above assistant response
            if (delta.reasoning_content) {
              if (!this.thinkingText) {
                // Stop loader before showing thinking
                this.loader.stop();
                this.tui.removeChild(this.loader);
                this.thinkingText = new Text("", 1, 0, ansi.bgGray);
                this.addMessage(this.thinkingText);
              }
              this.thinkingContent += delta.reasoning_content;
              this.thinkingText.setText(
                `${ansi.white(ansi.bold("Thinking"))}\n${ansi.white(this.thinkingContent)}`,
              );
              this.tui.requestRender();
            }

            // Handle content — append to streaming Markdown
            if (delta.content) {
              const md = ensureMd();
              this.streamingText += delta.content;
              md.setText(this.streamingText);
              this.tui.requestRender();
            }

            // Handle usage — update info bar in real-time
            if (event.chunk.usage) {
              const u = event.chunk.usage;
              this.turnUsage = {
                prompt: u.prompt_tokens,
                completion: u.completion_tokens,
                total: u.total_tokens,
              };
              this._updateInfoBar();
            }
            break;
          }

          case "tool_result": {
            totalToolCalls++;
            // Finalize thinking display if active (tool calls happen after thinking)
            if (this.thinkingText) {
              this.thinkingText = null;
            }
            // Format: [tool_name(params)] ✓/✗
            const status = event.result.success
              ? ansi.green("✓")
              : ansi.red("✗");
            const rawParams = JSON.stringify(event.params);
            const paramsStr =
              rawParams.length > 2
                ? ` ${rawParams.slice(0, 60)}${rawParams.length > 60 ? "..." : ""}`
                : "";
            const label = ansi.bold(`[${event.tool}${paramsStr}]`);
            this.addMessage(new Text(`  ${status} ${label}`, 1, 0));
            break;
          }

          case "done": {
            this.streamingMd = null;
            this.thinkingText = null;
            // Clear turn-level usage after turn completes
            this.turnUsage = null;
            if (totalToolCalls > 0) {
              this.addMessage(
                new Text(ansi.gray(`[${totalToolCalls} tool(s) used]`), 1, 0),
              );
            }
            // Add spacer after assistant response for visual separation
            this.addMessage(new Spacer(1));
            // Update info bar with latest session stats
            this._updateInfoBar();
            break;
          }

          case "save_error": {
            this.addMessage(
              new Text(`[Session save error: ${event.error}]`, 0, 0),
            );
            break;
          }

          case "agent_error": {
            this.streamingMd = null;
            this.thinkingText = null;
            this.addMessage(
              new Text(ansi.red(`[Agent error: ${event.error}]`), 0, 0),
            );
            break;
          }

          case "aborted": {
            this.streamingMd = null;
            this.thinkingText = null;
            this.addMessage(
              new Text(ansi.yellow("[Response aborted by user]"), 0, 0),
            );
            this.addMessage(new Spacer(1));
            break;
          }
        }
      }
    } catch (err) {
      this.streamingMd = null;
      this.thinkingText = null;
      this.addMessage(
        new Text(
          ansi.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
          0,
          0,
        ),
      );
    } finally {
      // Stop and remove loader
      this.loader.stop();
      this.tui.removeChild(this.loader);
      this.abortController = null;
      this.tui.requestRender();
    }
  }

  // ==========================================================================
  // Status bar
  // ==========================================================================

  /** Build the status bar text based on current session state. */
  private _buildStatusText(): string {
    const sid = this.coordinator.currentSessionId;
    const sessionPart = sid
      ? `${ansi.bold(ansi.green(`[${sid.slice(0, 8)}]`))}`
      : ansi.gray("[No session]");
    const hints = ansi.dim(
      "Ctrl+H History | Ctrl+N New | Ctrl+P Model | Esc Cancel",
    );
    return `${sessionPart}  ${hints}`;
  }

  /** Update the status bar text and trigger a render. */
  private updateStatusBar(): void {
    this.statusBar.setText(this._buildStatusText());
    this.tui.requestRender();
  }

  // ==========================================================================
  // Info bar (bottom of TUI: model + token/cost stats)
  // ==========================================================================

  /** Build the info bar text from coordinator session stats. */
  private _buildInfoBarText(): string {
    const modelPart = `Model: ${this.currentModelId}`;

    // Show turn-level usage during streaming, session-level after
    if (this.turnUsage) {
      const up = this._formatTokens(this.turnUsage.prompt);
      const down = this._formatTokens(this.turnUsage.completion);
      const total = this._formatTokens(this.turnUsage.total);
      return `${modelPart} | Tokens: ${up}↑ ${down}↓ (${total} total) | Cost: ...`;
    }

    const usage = this.coordinator.sessionUsage;
    let tokenPart: string;
    if (usage) {
      const up = this._formatTokens(usage.prompt_tokens);
      const down = this._formatTokens(usage.completion_tokens);
      const cache = this._formatTokens(usage.prompt_cache_hit_tokens ?? 0);
      tokenPart = `Tokens: ${up}↑ ${down}↓ cache:${cache}`;
    } else {
      tokenPart = "Tokens: --";
    }

    const billing = this.coordinator.sessionBilling;
    let costPart: string;
    if (billing) {
      const inCost = this._formatCost(billing.inputCost);
      const outCost = this._formatCost(billing.outputCost);
      const totalCost = this._formatCost(billing.totalCost);
      costPart = `Cost: ${inCost}↑ ${outCost}↓ = ${totalCost}`;
    } else {
      costPart = "Cost: --";
    }

    return `${modelPart} | ${tokenPart} | ${costPart}`;
  }

  /** Update the info bar text and trigger a render. */
  private _updateInfoBar(): void {
    this.infoBar.setText(this._buildInfoBarText());
    this.tui.requestRender();
  }

  /** Format a token count for display (e.g. 12500 → "12.5K"). */
  private _formatTokens(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  }

  /** Format a cost value for display (e.g. 0.0012 → "¥0.0012"). */
  private _formatCost(n: number): string {
    return `¥${n.toFixed(4)}`;
  }

  // ==========================================================================
  // New session
  // ==========================================================================

  /** Create a new session: clear coordinator state and chat area. */
  private handleNewSession(): void {
    this.coordinator.newSession();
    this.clearMessages();
    this.updateStatusBar();
    this._updateInfoBar();
    this.tui.requestRender();
  }

  /** Resume a session selected from autocomplete. */
  private async handleSessionSelect(sessionId: string): Promise<void> {
    try {
      await this.coordinator.resumeSession(sessionId);
      this.clearMessages();

      // Load and display the session's message history
      const messages = this.coordinator.getSessionMessages();
      if (messages.length > 0) {
        for (const msg of messages) {
          if (msg.role === "user") {
            this.addMessage(
              new Text(
                `${ansi.cyan("You")} ${ansi.dim("> ")} ${msg.content}`,
                0,
                0,
                ansi.bgGray,
              ),
            );
          } else if (msg.role === "assistant" && msg.content) {
            this.addMessage(
              new Markdown(
                msg.content,
                1,
                0,
                markdownTheme,
                assistantDefaultStyle,
              ),
            );
            this.addMessage(new Spacer(1));
          }
        }
      }

      this.updateStatusBar();
      this._updateInfoBar();
      this.tui.requestRender();
    } catch (err) {
      this.addMessage(
        new Text(
          err instanceof Error ? err.message : "Session not found.",
          0,
          0,
        ),
      );
    }
  }

  // ========================================================================
  // Model switching (Ctrl+P)
  // ========================================================================

  /** Cycle to the next model in the list (wraps around). */
  private cycleModel(): void {
    this.coordinator.switchModel();
    this.currentModelId = this.coordinator.currentModel;

    this.addMessage(
      new Text(
        `${ansi.cyan("Model")} ${ansi.dim("→")} ${ansi.bold(this.currentModelId)}`,
        0,
        0,
        ansi.bgGray,
      ),
    );
    this._updateInfoBar();
    this.tui.requestRender();
  }
}
