# babyAgent

> Lightweight terminal AI agent — a local CLI alternative to Claude Code, powered by DeepSeek.

babyAgent is an interactive, ReAct-based AI agent that runs in your terminal. It combines the reasoning power of DeepSeek LLMs with bash execution, filesystem operations, and MCP (Model Context Protocol) tools — all wrapped in a persistent, session-based REPL.

## Features

- **🤖 ReAct Agent Loop** — The agent thinks, acts, and observes in a loop: it calls tools, processes results, and refines its response until the task is complete.
- **💬 Interactive REPL** — Type any question or task; the agent responds with streaming output showing its reasoning and tool calls in real time.
- **📂 Session Persistence** — Every conversation is saved to `~/.babyAgent/sessions/`. Resume previous sessions with `/continue <id>`, list them with `/sessions`.
- **🛠️ Built-in Tools** — Execute bash commands, read/write files, search with grep, and manage the filesystem — all through the agent.
- **🔌 MCP Support** — Load tools from MCP servers (configured via `~/.babyAgent/mcp.json`). Supports stdio and HTTP/SSE transports.
- **🧠 Skill System** — Define reusable instruction files (SKILL.md with YAML frontmatter) placed in `~/.babyAgent/skills/` or `.babyAgent/skills/`. Skills can be auto-invoked by the model or manually triggered via `/skill:<name>`.
- **📡 Streaming Output** — Real-time streaming of the model's reasoning and answers, with live tool call results.
- **💾 Session Safety** — If the agent crashes mid-turn, the conversation is preserved and the session is restored to a clean state.

## Quick Start

### Prerequisites

- **Node.js** >= 18.0.0
- **pnpm** (recommended) or npm
- A **DeepSeek API key**

### Install & Run

```bash
# Clone the repository
git clone <repo-url>
cd babyAgent

# Install dependencies
pnpm install

# Build
pnpm build

# Run (requires DEEPSEEK_API_KEY environment variable)
DEEPSEEK_API_KEY="your-key-here" pnpm start
```

Or use the bundled binary directly:
```bash
DEEPSEEK_API_KEY="your-key-here" node dist/cli.js
```

## Usage

Once the REPL starts, you can:

### Chat with the agent

Just type any question or task. The agent will use its tools to help you.

```
babyAgent - Terminal AI Agent
Type /help for commands, or just ask a question.

> What files are in the current directory?
```

The agent will show its reasoning process and tool calls in real time:

```
[Session a1b2c3d4]
[Thinking...]
Let me list the files in the current directory...
  ✓ bash {"command": "ls -la"}
[1 tool(s) used]
Here are the files in the current directory: ...
```

### Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/new` or `/reset` | Start a new session |
| `/sessions` | List all saved sessions |
| `/continue <id>` | Resume a previous session (first 8 chars of ID) |
| `/tools` | List all available tools |
| `/skills` | List all available skills |
| `/skill:<name>` | Invoke a skill by name |
| `/mcp` | Show MCP server status |
| `/exit` | Exit the program |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        AppLoop (REPL)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │ CommandRouter │  │  Coordinator │  │ DisplayRenderer   │ │
│  │ (/commands)   │  │ (turn exec)  │  │ (streaming output)│ │
│  └──────┬───────┘  └──────┬───────┘  └───────────────────┘ │
└─────────┼─────────────────┼─────────────────────────────────┘
          │                 │
          ▼                 ▼
┌─────────────────────────────────────────────────────────────┐
│                     Agent (ReAct Loop)                      │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ LLMClient │  │  ToolRegistry │  │    SkillManager      │ │
│  │(DeepSeek) │  │ (bash, fs,   │  │  (SKILL.md discovery) │ │
│  │           │  │  MCP tools)  │  │                       │ │
│  └──────────┘  └──────────────┘  └───────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│                   SessionManager (Persistence)              │
│  meta.json (metadata)  +  .jsonl (append-only turns)       │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

| Module | Path | Description |
|--------|------|-------------|
| **Agent** | `src/index.ts` | Core ReAct loop: sends messages to LLM, executes tool calls, iterates until done |
| **Coordinator** | `src/coordinator.ts` | Manages session lifecycle and turn execution; sits between the CLI display and the Agent + SessionManager |
| **SessionManager** | `src/session.ts` | Persists conversations as metadata JSON + append-only JSONL turns |
| **SkillManager** | `src/skills.ts` | Discovers and manages skills from `~/.babyAgent/skills/` and `.babyAgent/skills/` |
| **LLM Client** | `src/llm/` | DeepSeek API client with streaming support and tool-calling |
| **Tool Interface** | `src/tools/interface/` | Generic Tool interface, JSON schema definitions, and registry |
| **Built-in Tools** | `src/tools/` | Bash execution and filesystem tools (read, write, find, grep, edit) |
| **MCP** | `src/mcp/` | Model Context Protocol integration — loads tools from external servers |
| **CLI** | `src/cli/` | App factory, REPL loop, command routing, and display rendering |

## Project Structure

```
babyAgent/
├── src/
│   ├── cli/              # CLI application
│   │   ├── app-factory.ts    # Dependency injection & wiring
│   │   ├── app-loop.ts       # Readline REPL loop
│   │   ├── command-router.ts # Slash command handling
│   │   └── display-renderer.ts # Streaming output renderer
│   ├── llm/              # LLM client (DeepSeek)
│   │   ├── types.ts          # Core types (Message, LLMResponse, etc.)
│   │   ├── deepseek.ts       # DeepSeek API implementation
│   │   └── index.ts          # Public re-exports
│   ├── mcp/              # Model Context Protocol
│   │   ├── config.ts         # MCP configuration parsing
│   │   ├── mcp-manager.ts    # Server lifecycle management
│   │   ├── tool-adapter.ts   # MCP tool to internal Tool adapter
│   │   └── transports/       # Stdio/HTTP transport implementations
│   ├── tools/            # Built-in tool implementations
│   │   ├── interface/         # Generic Tool interface & registry
│   │   │   ├── index.ts          # Tool, ToolResult, JsonSchema types
│   │   │   └── registry.ts       # DefaultToolRegistry
│   │   ├── bash/             # Bash execution tool
│   │   └── fs/               # Filesystem tools (read, write, find, grep, edit)
│   ├── index.ts          # Agent class (ReAct loop)
│   ├── coordinator.ts    # Session + turn lifecycle
│   ├── session.ts        # Session persistence
│   ├── skills.ts         # Skill discovery & management
│   └── cli.ts            # Entry point
├── tests/               # Test suites
│   ├── agent/               # Agent, Coordinator, Session, Skills tests
│   ├── bash-tool/           # Bash tool tests
│   ├── fs-tool/             # Filesystem tool tests
│   └── mcp/                 # MCP config & adapter tests
├── docs/                # Documentation
│   └── agents/              # Agent workflow docs
├── scripts/             # Dev scripts (chat verification, bundling)
├── dist/                # Built output (esbuild-bundled)
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DEEPSEEK_API_KEY` | Yes | Your DeepSeek API key |

### MCP Servers

Configure MCP servers in `~/.babyAgent/mcp.json`:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
      "env": {}
    }
  }
}
```

### Skills

Skills are directories containing a `SKILL.md` file with YAML frontmatter:

```markdown
---
description: Instructions for handling a specific type of task
name: my-skill
disable-model-invocation: false
---
... skill instructions ...
```

Place them in:
- `~/.babyAgent/skills/` (user-level, available across all projects)
- `.babyAgent/skills/` (project-level, overrides user-level with same name)

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm build` | Type-check + bundle with esbuild |
| `pnpm clean` | Remove `dist/` |
| `pnpm start` | Run the CLI from built output |
| `pnpm test` | Run all tests (vitest) |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm verify:chat` | Quick chat verification via tsx |

## Tech Stack

- **Runtime**: Node.js >= 18
- **Language**: TypeScript (ES2022, strict mode)
- **Build**: esbuild (bundle) + tsc (declarations)
- **LLM Provider**: DeepSeek API (with streaming & tool calling)
- **Testing**: Vitest
- **Linting**: Biome
- **Package Manager**: pnpm
- **License**: MIT

## License

MIT
