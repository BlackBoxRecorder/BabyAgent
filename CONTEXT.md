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

**Autocomplete Session History**:
The mechanism for browsing historical sessions via the `/sessions` slash command's autocomplete dropdown. Replaces the previous Ctrl+H keyboard shortcut and overlay display. Selecting a session from the autocomplete list directly resumes that session.
_Avoid_: Session browser, history popup, session selector

**Editor**:
The multi-line text input area at the bottom of the TUI. Supports autocomplete, paste handling, and IME. From Pi TUI's `Editor` component.
_Avoid_: Input box, text field, prompt line

**TUI**:
The Terminal User Interface layer built with `@earendil-works/pi-tui`. Replaces the readline-based `AppLoop` + `DisplayRenderer`. Owns layout, rendering, and keyboard input routing.
_Avoid_: GUI, curses, screen

**Model Config**:
A JSON file at `~/.babyAgent/models.json` defining providers, their API endpoints, auth, and available models. Single source of truth for LLM connectivity.
_Avoid_: Config file, settings, provider config

**System Prompt**:
A Markdown file at `~/.babyAgent/system_prompt.md` containing the base instructions for the AI agent. Loaded at startup and concatenated with skills. Users can customize agent behavior by editing this file.
_Avoid_: Prompt file, system instructions, base prompt

**Provider**:
An LLM service (e.g. DeepSeek) with a base URL, API key, and a list of models. `providers` mapping in the model config.
_Avoid_: Service, backend

**Model**:
A specific LLM version exposed by a provider. Identified by `id` (used both for display and API calls). Has a context window, max tokens, and cost structure.
_Avoid_: Version, variant, engine

**Turn Usage**:
Aggregated token consumption across all LLM calls within a single Turn. Contains prompt/completion/cache/reasoning token totals. Only available on successful (non-aborted, non-error) turns.
_Avoid_: Iteration usage, per-call usage

**Billing**:
The computed cost of a Turn, derived from the Turn Usage and the active Model's cost rates (input/output/cacheRead/cacheWrite). Computed by the Agent after a successful turn completes.
_Avoid_: Price, fee, charge

**Context Size**:
The total token count of the conversation context visible to the LLM. Reported as the `prompt_tokens` from the last successful API call. Available via the Coordinator.
_Avoid_: Window size, token count, context window

**Info Bar**:
A single-line status display at the very bottom of the TUI, below the Editor. Shows the active Model name, Session-level aggregated token usage (input↑/output↓/total∑/cache), and cumulative cost (input↑/output↓/total in ¥). Updated after each completed Turn. Managed by `TuiLoop`.
_Avoid_: Footer, status line, bottom bar

**Model Name**:
The identifier string of the currently active LLM model (e.g. `deepseek-chat`). Exposed via `Coordinator.currentModel` for display in the TUI status bar.
_Avoid_: Model ID, model version

**Logger**:
The centralized logging component that records agent interactions to files. Manages log levels, formatting, and file I/O. Configured via environment variables.
_Avoid_: Recorder, tracker

**Log Entry**:
A structured JSON object containing a timestamp, log level, component name, event type, and event-specific data. Written to log files.
_Avoid_: Log record, log line

**Log File**:
A text file in `~/.babyAgent/logs/` containing log entries for a specific session and date. Named `{date}/session-{sessionId}.log`.
_Avoid_: Log output, log document

**Memory**:
Cross-session storage for user preferences, learned patterns, and corrections. Persisted as Markdown files under `~/.babyAgent/`.
_Avoid_: Profile, state, cache
