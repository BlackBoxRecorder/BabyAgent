# Use @earendil-works/pi-tui as the TUI framework

babyAgent needs a Terminal User Interface with markdown rendering, multi-line input, keyboard shortcuts, session history browsing, and streaming output. We chose `@earendil-works/pi-tui` over three alternatives.

## Considered Options

**neo-blessed** — mature widget-based TUI toolkit. Ruled out because markdown rendering and multi-line input require significant custom work; each widget type needs separate integration.

**ink** — React-based TUI framework. Ruled out because it pulls in the React runtime, has a steep learning curve for a non-React codebase, and multi-line input is not a first-class primitive.

**Enhanced readline** — keeping the current readline REPL and layering ANSI escapes on top. Ruled out because it rapidly becomes a hand-rolled, untested TUI framework with no widget primitives.

## Decision

`@earendil-works/pi-tui` provides all four required primitives out of the box: `Markdown` (with syntax highlighting and theming), `Editor` (multi-line with autocomplete and IME support), `matchesKey`/`Key` (modifier-aware key detection), `SelectList` (session history browsing), and `showOverlay` (for future tool-confirmation dialogs). It is independently usable via `new TUI(new ProcessTerminal())` and does not depend on the Pi coding agent runtime.

This choice carries meaningful lock-in — the component interface (`render(width) → string[]` + `handleInput(data)`) shapes every UI component we build. Swapping to a different TUI framework later would require rewriting the entire TUI layer. However, the Coordinator API (which yields `TurnEvent` streams) remains framework-agnostic, so the core agent logic is insulated.
