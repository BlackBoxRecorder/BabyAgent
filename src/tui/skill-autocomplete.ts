/**
 * SkillAutocompleteProvider — provides autocomplete suggestions for the
 * `/skill:` slash command. When the user types `/skill:`, it lists all
 * available skills for selection.
 *
 * Selection places `/skill:<name> ` in the editor (with trailing space)
 * so the user can append instructions before sending.
 */
import type {
  AutocompleteProvider,
  AutocompleteSuggestions,
  AutocompleteItem,
} from "@earendil-works/pi-tui";
import type { SkillManager } from "../skills.js";

export class SkillAutocompleteProvider implements AutocompleteProvider {
  private skillManager: SkillManager;
  private wrapped: AutocompleteProvider | null;

  constructor(skillManager: SkillManager, wrapped?: AutocompleteProvider) {
    this.skillManager = skillManager;
    this.wrapped = wrapped ?? null;
  }

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    _options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const line = lines[cursorLine] || "";
    const prefix = line.slice(0, cursorCol).trim();

    // Trigger on `/skill` or `/skill:` prefix
    if (
      prefix === "/skill" ||
      prefix === "/skill:" ||
      prefix.startsWith("/skill:")
    ) {
      const skills = this.skillManager.getSkills();
      if (skills.length === 0) {
        return { items: [], prefix };
      }

      const items: AutocompleteItem[] = skills.map((s) => {
        const tag = s.disableModelInvocation ? "[manual]" : "[auto]";
        const source = s.source === "user" ? "user" : "project";
        return {
          value: s.name,
          label: `${s.name.padEnd(20)} ${tag} [${source}]`,
          description: s.description,
        };
      });

      return { items, prefix };
    }

    // Fall through to wrapped provider
    if (this.wrapped) {
      return this.wrapped.getSuggestions(
        lines,
        cursorLine,
        cursorCol,
        _options,
      );
    }
    return null;
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    _prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    // If input starts with `/skill`, handle skill selection ourselves
    const currentLine = lines[cursorLine] || "";
    const linePrefix = currentLine.slice(0, cursorCol).trim();
    if (
      linePrefix === "/skill" ||
      linePrefix === "/skill:" ||
      linePrefix.startsWith("/skill:")
    ) {
      const newLine = `/skill:${item.value} `;
      const newLines = [...lines];
      newLines[cursorLine] = newLine;
      return {
        lines: newLines,
        cursorLine,
        cursorCol: newLine.length,
      };
    }

    // Fall through to wrapped provider for other items
    if (this.wrapped) {
      return this.wrapped.applyCompletion(
        lines,
        cursorLine,
        cursorCol,
        item,
        _prefix,
      );
    }
    return { lines, cursorLine, cursorCol };
  }

  get triggerCharacters(): string[] {
    return this.wrapped?.triggerCharacters ?? [];
  }

  shouldTriggerFileCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  ): boolean {
    return (
      this.wrapped?.shouldTriggerFileCompletion?.(
        lines,
        cursorLine,
        cursorCol,
      ) ?? false
    );
  }
}
