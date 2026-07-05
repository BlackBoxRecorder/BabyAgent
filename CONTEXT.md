# babyAgent

A lightweight terminal AI agent — a ReAct loop backed by an LLM with bash/filesystem/MCP tools and session persistence. This context defines the terms shared across the CLI, TUI, agent core, and persistence layers.

## Language

**Turn**:
A single user–Agent exchange: user input → (ReAct loop: LLM calls + tool executions) → final response.
_Avoid_: Round, iteration, message

**Session**:
A persisted conversation with a unique ID, title, metadata, and ordered Turns. Lives on disk as `{id}.jsonl` + `{id}.meta.json`.
_Avoid_: Conversation, thread, chat

**Coordinator**:
The middle layer between display adapters (CLI / TUI) and the Agent + SessionManager. Owns session lifecycle and turn execution. Yields `TurnEvent` streams.
_Avoid_: Controller, orchestrator

**Stream Chunk**:
An incremental text delta from the LLM during streaming response. May contain `reasoning_content` (thinking) or `content` (visible answer).
_Avoid_: Token, fragment, piece

**Tool Call**:
The Agent's request to execute a tool (bash, file operation, MCP). Contains a tool name, parsed arguments, and returns a `ToolResult`.
_Avoid_: Function call, action

**Slash Command**:
A user-typed line starting with `/` (e.g. `/help`, `/sessions`, `/skill:name`). Routed through `CommandRouter`, not sent to the Agent.
_Avoid_: Meta-command, control command

**Skill**:
A markdown file (`SKILL.md` in a named directory) containing specialized instructions. Can be auto-invoked by the Agent or manually via `/skill:<name>`.
_Avoid_: Plugin, extension, prompt template

**Overlay**:
A TUI component rendered above the main chat area — modals, selection dialogs, confirmation prompts. Uses Pi TUI's `showOverlay()`.
_Avoid_: Popup, dialog, modal (use "Overlay" for consistency with Pi TUI terminology)

**Editor**:
The multi-line text input area at the bottom of the TUI. Supports autocomplete, paste handling, and IME. From Pi TUI's `Editor` component.
_Avoid_: Input box, text field, prompt line

**TUI**:
The Terminal User Interface layer built with `@earendil-works/pi-tui`. Replaces the readline-based `AppLoop` + `DisplayRenderer`. Owns layout, rendering, and keyboard input routing.
_Avoid_: GUI, curses, screen
