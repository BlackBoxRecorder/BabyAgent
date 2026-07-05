/**
 * AppLoop — the readline-driven REPL that ties everything together.
 *
 * Owns the readline interface and the main event loop: each line of user
 * input is either routed through CommandRouter (slash-commands) or sent
 * directly to the coordinator for a chat turn (plain text).
 */
import * as readline from "node:readline";
import type { ConversationCoordinator } from "../coordinator.js";
import type { McpManager } from "../mcp/index.js";
import type { CommandRouter } from "./command-router.js";
import type { DisplayRenderer } from "./display-renderer.js";

// ============================================================================
// AppLoop
// ============================================================================

export class AppLoop {
  constructor(
    private coordinator: ConversationCoordinator,
    private commandRouter: CommandRouter,
    private display: DisplayRenderer,
    private mcpManager: McpManager,
  ) {}

  /**
   * Start the readline REPL. Blocks until the user exits via /exit or
   * the readline stream closes.
   */
  start(): void {
    this.display.println("babyAgent - Terminal AI Agent");
    this.display.println("Type /help for commands, or just ask a question.");
    this.display.println("");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "> ",
    });

    rl.prompt();

    rl.on("line", async (line: string) => {
      const input = line.trim();

      if (!input) {
        rl.prompt();
        return;
      }

      try {
        if (input.startsWith("/")) {
          const result = await this.commandRouter.route(input);
          if (result.type === "exit") {
            rl.close();
            return;
          }
          if (result.type === "chat") {
            // when use skill return chat
            await this.display.renderTurn(
              this.coordinator.executeTurn(result.input),
            );
          }
          // result.type === "handled" pass
        } else {
          await this.display.renderTurn(this.coordinator.executeTurn(input));
        }
        this.display.println("");
      } catch (err) {
        this.display.println(
          `Command error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      rl.prompt();
    });

    rl.on("close", async () => {
      this.display.println("\nGoodbye!");
      await this.mcpManager.dispose();
      process.exit(0);
    });
  }
}
