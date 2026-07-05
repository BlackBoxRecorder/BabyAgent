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
  SelectList,
  Spacer,
  CombinedAutocompleteProvider,
  matchesKey,
  Key,
  type EditorTheme,
  type MarkdownTheme,
  type SelectListTheme,
} from "@earendil-works/pi-tui";
import type { ConversationCoordinator } from "../coordinator.js";
import type { McpManager } from "../mcp/index.js";
import type { CommandRouter } from "./command-router.js";
import type { ExecuteTurnOptions } from "../coordinator.js";

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

/** Reuse the same select-list styling as the editor theme. */
const selectListTheme: SelectListTheme = editorTheme.selectList;

// ============================================================================
// TuiLoop
// ============================================================================

export class TuiLoop {
  private coordinator: ConversationCoordinator;
  private commandRouter: CommandRouter;
  private mcpManager: McpManager;
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

  constructor(
    coordinator: ConversationCoordinator,
    commandRouter: CommandRouter,
    mcpManager: McpManager,
  ) {
    this.coordinator = coordinator;
    this.commandRouter = commandRouter;
    this.mcpManager = mcpManager;

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
    this.editor.setAutocompleteProvider(
      new CombinedAutocompleteProvider(
        [
          { name: "help", description: "Show help message" },
          { name: "new", description: "Start a new session (or Ctrl+N)" },
          { name: "reset", description: "Same as /new" },
          { name: "sessions", description: "List session history" },
          {
            name: "continue",
            description: "Continue a previous session",
            argumentHint: "<id>",
          },
          { name: "tools", description: "List available tools" },
          { name: "skills", description: "List available skills" },
          {
            name: "skill:",
            description: "Invoke a skill by name. E.g. /skill:code-review",
            argumentHint: "<name>",
          },
          { name: "mcp", description: "List MCP server status" },
          { name: "exit", description: "Exit the program" },
        ],
        process.cwd(),
      ),
    );

    this.tui.addChild(this.editor);

    // Focus the editor
    this.tui.setFocus(this.editor);

    // Loading indicator (hidden by default, added to TUI only when active)
    this.loader = new Loader(this.tui, ansi.cyan, ansi.gray, "");

    // Ctrl+C to exit
    this.tui.addInputListener((data) => {
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
      // Ctrl+H: show session history overlay
      if (matchesKey(data, Key.ctrl("h"))) {
        this.showSessionsOverlay();
        return { consume: true };
      }
      // Ctrl+N: new session
      if (matchesKey(data, Key.ctrl("n"))) {
        this.handleNewSession();
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
        await this.handleSlashCommand(input);
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
  // Slash command handling
  // ==========================================================================

  private async handleSlashCommand(input: string): Promise<void> {
    // Handle display-only commands directly (avoid stdout leak from route() println)
    if (input === "/help") {
      this.addMessage(new Text(this.commandRouter.getHelpText(), 0, 0));
      return;
    }
    if (input === "/tools") {
      this.addMessage(new Text(this.commandRouter.getToolsText(), 0, 0));
      return;
    }
    if (input === "/skills") {
      this.addMessage(new Text(this.commandRouter.getSkillsText(), 0, 0));
      return;
    }
    if (input === "/mcp") {
      this.addMessage(new Text(this.commandRouter.getMcpStatusText(), 0, 0));
      return;
    }
    if (input === "/sessions") {
      const sessionsText = await this.commandRouter.getSessionsText();
      this.addMessage(new Text(sessionsText, 0, 0));
      await this.showSessionsOverlay();
      return;
    }
    if (input === "/new" || input === "/reset") {
      this.handleNewSession();
      return;
    }

    // Delegate to CommandRouter for commands with complex logic:
    // /continue, /skill:, /exit, and unknown slash commands
    const result = await this.commandRouter.route(input);

    switch (result.type) {
      case "exit":
        await this.shutdown();
        break;
      case "chat":
        // Skill command returned chat input
        await this.executeTurn(result.input);
        break;
      case "handled": {
        if (input.startsWith("/continue ")) {
          const sessionId = input.slice("/continue ".length).trim();
          if (sessionId) {
            this.clearMessages();
            this.addMessage(
              new Text(`[Switched to session ${sessionId.slice(0, 8)}]`, 0, 0),
            );
          }
        }
        break;
      }
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
                `${ansi.dim(ansi.bold("Thinking"))}\n${ansi.dim(this.thinkingContent)}`,
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
            if (totalToolCalls > 0) {
              this.addMessage(
                new Text(ansi.gray(`[${totalToolCalls} tool(s) used]`), 1, 0),
              );
            }
            // Add spacer after assistant response for visual separation
            this.addMessage(new Spacer(1));
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
    const hints = ansi.dim("Ctrl+H History | Ctrl+N New | Esc Cancel");
    return `${sessionPart}  ${hints}`;
  }

  /** Update the status bar text and trigger a render. */
  private updateStatusBar(): void {
    this.statusBar.setText(this._buildStatusText());
    this.tui.requestRender();
  }

  // ==========================================================================
  // New session
  // ==========================================================================

  /** Create a new session: clear coordinator state and chat area. */
  private handleNewSession(): void {
    this.coordinator.newSession();
    this.clearMessages();
    this.updateStatusBar();
    this.tui.requestRender();
  }

  // ==========================================================================
  // Overlays
  // ==========================================================================

  private async showSessionsOverlay(): Promise<void> {
    const sessions = await this.coordinator.listSessions();
    if (sessions.length === 0) {
      this.addMessage(new Text("No session history.", 0, 0));
      return;
    }

    const currentId = this.coordinator.currentSessionId;
    const items = sessions.map((s) => {
      const marker = s.id === currentId ? "* " : "";
      const date = new Date(s.createdAt).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const truncatedTitle =
        s.title.length > 40 ? s.title.slice(0, 40) + "…" : s.title;
      return {
        value: s.id,
        label: `${marker}${s.id.slice(0, 8)}  [${date}]  ${truncatedTitle}`,
        description: `${s.turnCount} turns`,
      };
    });

    const list = new SelectList(items, 15, selectListTheme);

    list.onSelect = async (item) => {
      try {
        await this.coordinator.resumeSession(item.value);
        this.clearMessages();

        // Load and display the session's message history
        const messages = this.coordinator.getSessionMessages();
        if (messages.length > 0) {
          for (const msg of messages) {
            if (msg.role === "user") {
              this.addMessage(
                new Text(
                  `${ansi.cyan("You")} ${ansi.dim(">")} ${msg.content}`,
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
    };

    this.tui.showOverlay(list, {
      anchor: "center",
      width: "90%",
      maxHeight: "60%",
    });
  }
}
