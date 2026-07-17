/**
 * SessionAutocompleteProvider — wraps CombinedAutocompleteProvider to add
 * dynamic session history completion for the /sessions command.
 */
import type {
  AutocompleteProvider,
  AutocompleteSuggestions,
  AutocompleteItem,
} from "@earendil-works/pi-tui";
import type { ConversationCoordinator } from "../coordinator.js";

export interface SessionAutocompleteOptions {
  /** Called when a session item is selected from completion. */
  onSessionSelect: (sessionId: string) => void;
}

export class SessionAutocompleteProvider implements AutocompleteProvider {
  private wrapped: AutocompleteProvider;
  private coordinator: ConversationCoordinator;
  private onSessionSelect: (sessionId: string) => void;

  constructor(
    wrapped: AutocompleteProvider,
    coordinator: ConversationCoordinator,
    options: SessionAutocompleteOptions,
  ) {
    this.wrapped = wrapped;
    this.coordinator = coordinator;
    this.onSessionSelect = options.onSessionSelect;
  }

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const line = lines[cursorLine] || "";
    const prefix = line.slice(0, cursorCol).trim();

    // Check if the input starts with /sessions
    if (prefix === "/sessions" || prefix.startsWith("/sessions ")) {
      // Get session list
      const sessions = await this.coordinator.listSessions();
      if (sessions.length === 0) {
        return { items: [], prefix };
      }

      const currentId = this.coordinator.currentSessionId;
      const items: AutocompleteItem[] = sessions.map((s) => {
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

      return { items, prefix };
    }

    // Delegate to wrapped provider for other commands
    return this.wrapped.getSuggestions(lines, cursorLine, cursorCol, options);
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    // If this is a session item (value looks like a session ID), trigger session selection
    // Session IDs are of format: {8-char hex}-{ISO datetime}
    if (/^[0-9a-f]{8}-\d{8}T\d{6}/.test(item.value)) {
      // Call the callback to handle session selection
      this.onSessionSelect(item.value);
      // Return the original lines (no text change) because the callback will handle the session switch
      return { lines, cursorLine, cursorCol };
    }

    // Delegate to wrapped provider for other items
    return this.wrapped.applyCompletion(
      lines,
      cursorLine,
      cursorCol,
      item,
      prefix,
    );
  }

  get triggerCharacters(): string[] {
    return this.wrapped.triggerCharacters ?? [];
  }

  shouldTriggerFileCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  ): boolean {
    return (
      this.wrapped.shouldTriggerFileCompletion?.(
        lines,
        cursorLine,
        cursorCol,
      ) ?? false
    );
  }
}
