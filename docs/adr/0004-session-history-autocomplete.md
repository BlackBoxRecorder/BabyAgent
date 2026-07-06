# Use autocomplete instead of overlay for session history browsing

## Status

Accepted

## Context

The TUI previously supported browsing session history via a keyboard shortcut (Ctrl+H) that opened a modal overlay (`SelectList`). Users requested removing the overlay and keyboard shortcut in favor of a more integrated approach where session history is accessible through the `/sessions` slash command's autocomplete.

## Decision

We removed the Ctrl+H keyboard shortcut and the associated overlay display. Instead, when a user types `/sessions` in the input, the autocomplete dropdown now shows the list of historical sessions. Selecting a session from the autocomplete list directly resumes that session (equivalent to `/continue <session-id>`). Pressing Enter without selecting from autocomplete does nothing (the user must select from the list).

## Consequences

- **Positive**: Reduces UI complexity by eliminating a modal overlay and keyboard shortcut. Integrates session browsing into the existing command/autocomplete paradigm, making it more discoverable for users familiar with slash commands.
- **Positive**: Autocomplete provides inline filtering and consistent styling with other commands.
- **Negative**: Users who prefer keyboard-driven navigation may find the autocomplete approach less efficient than a dedicated shortcut.
- **Negative**: The `/sessions` command no longer displays a text list of sessions when pressed Enter; users must use autocomplete to browse.

## Alternatives Considered

1. **Keep Ctrl+H but change to autocomplete trigger**: Ctrl+H would trigger the autocomplete for `/sessions`. Rejected because the user explicitly requested removing keyboard shortcuts.
2. **Keep overlay but remove Ctrl+H**: Display session history as an overlay only when `/sessions` is typed and Enter is pressed. Rejected because the user requested no overlay display.
3. **Hybrid approach**: Show autocomplete for `/sessions`, but also allow Enter to display a text list. Rejected because the user said "do nothing" when Enter is pressed without selection.