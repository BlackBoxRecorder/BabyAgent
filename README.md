# babyAgent

> 轻量级终端 AI 智能体 — 类 Claude Code 的本地 CLI 替代方案，由 DeepSeek 驱动。

babyAgent 是一个基于 **ReAct**（推理-行动-观察）模式的交互式 AI 智能体，运行在终端中。它将 DeepSeek 等 LLM 的强大推理能力与 bash 执行、文件系统操作和 MCP（Model Context Protocol）工具相结合，封装在持久化的会话式 REPL 中。

## 特性

- **🤖 ReAct 智能体循环** — 智能体在"思考→行动→观察"的循环中迭代：调用工具、处理结果、优化响应，直至任务完成
- **💻 现代化 TUI 界面** — 基于 pi-tui 框架的终端用户界面，支持 Markdown 渲染、多行输入、自动补全和键盘快捷键
- **📂 会话持久化** — 每次对话自动保存到 `~/.babyAgent/sessions/`；可通过 `/continue <id>` 恢复、`/sessions` 列出
- **🛠️ 内置工具集** — 执行 bash 命令、读写文件、grep 搜索、find 查找、diff 编辑文件 — 全部通过智能体驱动
- **🔌 MCP 协议支持** — 加载外部 MCP 服务器提供的工具（通过 `~/.babyAgent/mcp.json` 配置），支持 stdio 和 HTTP/SSE 两种传输方式
- **🧠 技能系统** — 可复用的指令文件（含 YAML 前置元数据的 SKILL.md），放置在 `~/.babyAgent/skills/` 或 `.babyAgent/skills/` 中；可被模型自动调用或通过 `/skill:<名称>` 手动触发
- **📡 流式输出** — 实时流式显示模型的推理过程和回答，包括思考过程（reasoning_content）和工具调用结果
- **💾 会话安全** — 若智能体在轮次中崩溃，对话内容仍会保存，会话恢复到干净状态
- **🔄 模型切换** — 支持多模型配置，按 `Ctrl+P` 即可在配置的模型间循环切换
- **💰 费用追踪** — 实时显示 token 用量和费用统计，支持缓存命中计费

## 快速开始

### 环境要求

- **Node.js** >= 18.0.0
- **pnpm**（推荐）或 npm
- 一个 **LLM API key**（默认使用 DeepSeek）

### 安装与运行

```bash
# 克隆仓库
git clone <仓库地址>
cd babyAgent

# 安装依赖
pnpm install

# 构建
pnpm build

# 运行（需设置 API key）
DEEPSEEK_API_KEY="your-key-here" pnpm start
```

或直接使用构建好的入口文件：

```bash
DEEPSEEK_API_KEY="your-key-here" node dist/cli.js
```

## 使用指南

启动后，你将进入基于 pi-tui 的现代化终端界面：

### 对话

直接输入任何问题或任务，智能体会利用其工具来帮助你。

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+C` | 退出程序 |
| `Esc` | 取消正在进行的智能体响应 |
| `Ctrl+N` | 开始新会话 |
| `Ctrl+P` | 切换到下一个模型 |

### 斜杠命令

| 命令 | 描述 |
|------|------|
| `/help` | 显示帮助信息 |
| `/new` 或 `/reset` | 开始新会话 |
| `/sessions` | 列出所有保存的会话（支持自动补全选择） |
| `/tools` | 列出所有可用工具 |
| `/skill:<名称>` | 调用指定技能（支持自动补全） |
| `/mcp` | 显示 MCP 服务器状态 |
| `/exit` 或 `/quit` 或 `/q` | 退出程序 |

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     TuiLoop (pi-tui 界面)                        │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────────┐ │
│  │  CommandHandler│   │  Coordinator │   │  Markdown 渲染       │ │
│  │  (斜杠命令路由)   │   │  (轮次执行)   │   │  (流式输出显示)      │ │
│  └──────┬───────┘   └──────┬───────┘   └─────────────────────┘ │
└─────────┼───────────────────┼───────────────────────────────────┘
          │                   │
          ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Agent (ReAct 循环)                           │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────────┐ │
│  │  ChatClient   │   │ ToolRegistry │   │   SkillManager      │ │
│  │  (LLM 客户端)  │   │ (bash, fs,   │   │  (SKILL.md 发现)    │ │
│  │               │   │  MCP 工具)   │   │                     │ │
│  └──────────────┘   └──────────────┘   └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────┐
│                  SessionManager (持久化层)                        │
│  meta.json (元数据)  +  .jsonl (仅追加的轮次记录)                  │
└─────────────────────────────────────────────────────────────────┘
```

### 核心组件

| 模块 | 路径 | 描述 |
|------|------|------|
| **Agent** | `src/agent.ts` | 核心 ReAct 循环：发送消息到 LLM -> 执行工具调用 -> 迭代直至完成；实现 AgentSession 接口 |
| **Coordinator** | `src/coordinator.ts` | 管理会话生命周期和轮次执行；位于显示层与 Agent + SessionManager 之间 |
| **SessionManager** | `src/session.ts` | 将会话持久化为元数据 JSON + 仅追加的 JSONL 轮次记录 |
| **SkillManager** | `src/skills.ts` | 从 `~/.babyAgent/skills/` 和 `.babyAgent/skills/` 发现并管理技能 |
| **ChatClient** | `src/llm/llm.ts` | 通用 LLM 客户端，使用 OpenAI 兼容接口，支持流式传输和工具调用，兼容多供应商多模型 |
| **Model Config** | `src/llm/models.ts` | 从 `~/.babyAgent/models.json` 加载模型配置，支持环境变量引用解析 |
| **Billing** | `src/llm/billing.ts` | 基于 token 用量和模型定价计算费用 |
| **System Prompt** | `src/llm/prompt.ts` | 从 `~/.babyAgent/system_prompt.md` 加载系统提示词，自动创建默认文件 |
| **Tool Interface** | `src/tools/interface/` | 通用的 Tool 接口、JSON Schema 定义和注册中心 |
| **Bash 工具** | `src/tools/bash/` | bash 命令执行工具，支持超时控制 |
| **文件系统工具** | `src/tools/fs/` | 文件读写、查找、grep 搜索、diff 编辑等文件系统工具集 |
| **MCP 管理器** | `src/mcp/mcp-manager.ts` | MCP 服务器生命周期管理、工具发现和适配 |
| **MCP 配置** | `src/mcp/config.ts` | MCP 配置解析和验证，兼容 Claude Code 配置格式 |
| **MCP 传输层** | `src/mcp/transports/` | stdio 和 HTTP/SSE 两种传输方式实现 |
| **TUI** | `src/cli/tui-loop.ts` | 基于 pi-tui 的终端界面，支持 Markdown 渲染、多行输入、自动补全 |
| **命令处理器** | `src/cli/command.ts` | 斜杠命令路由和处理 |
| **会话自动补全** | `src/cli/session-autocomplete.ts` | `/sessions` 命令的动态会话历史自动补全 |
| **技能自动补全** | `src/cli/skill-autocomplete.ts` | `/skill:` 命令的技能名称自动补全 |
| **Logger** | `src/logger.ts` | 基于 pino 的结构化日志系统，支持组件级别的事件追踪 |

## 项目结构

```
babyAgent/
├── src/                    # 源代码
│   ├── cli/                # CLI 应用程序
│   │   ├── app-factory.ts      # 依赖注入与组件组装
│   │   ├── command.ts          # 斜杠命令路由与处理
│   │   ├── session-autocomplete.ts  # 会话历史自动补全
│   │   ├── skill-autocomplete.ts    # 技能名称自动补全
│   │   └── tui-loop.ts        # pi-tui 终端界面主循环
│   ├── llm/                # LLM 客户端
│   │   ├── types.ts           # 核心类型（Message, LLMResponse 等）
│   │   ├── llm.ts             # ChatClient 实现（OpenAI 兼容接口）
│   │   ├── models.ts          # 模型配置加载与解析
│   │   ├── billing.ts         # 费用计算器
│   │   ├── prompt.ts          # 系统提示词加载
│   │   └── index.ts           # 公开导出
│   ├── mcp/                # Model Context Protocol
│   │   ├── config.ts          # MCP 配置解析与验证
│   │   ├── mcp-manager.ts     # 服务器生命周期管理
│   │   ├── tool-adapter.ts    # MCP 工具到内部 Tool 的适配器
│   │   └── transports/        # stdio/HTTP 传输实现
│   ├── tools/              # 内置工具实现
│   │   ├── interface/         # 通用 Tool 接口与注册中心
│   │   │   ├── index.ts          # Tool, ToolResult, JsonSchema 类型
│   │   │   └── registry.ts       # DefaultToolRegistry
│   │   ├── bash/              # bash 执行工具
│   │   └── fs/                # 文件系统工具（read, write, ls, find, grep, edit）
│   ├── agent.ts            # Agent 类（ReAct 循环）
│   ├── coordinator.ts      # 会话 + 轮次生命周期
│   ├── session.ts          # 会话持久化
│   ├── skills.ts           # 技能发现与管理
│   ├── logger.ts           # 日志系统
│   ├── cli.ts              # 程序入口点
│   └── index.ts            # 库导出入口
├── tests/                  # 测试套件
│   ├── agent/                  # Agent、Coordinator、Session、Skills 测试
│   ├── bash-tool/              # Bash 工具测试
│   ├── fs-tool/                # 文件系统工具测试
│   └── mcp/                    # MCP 配置与适配器测试
├── docs/                   # 文档
│   ├── adr/                    # 架构决策记录
│   ├── agents/                 # 智能体工作流文档
│   ├── tutorials/              # 教程
│   └── tui/                    # pi-tui 文档
├── scripts/                # 开发脚本
├── .qoder/skills/          # Qoder 技能文件
├── dist/                   # 构建输出
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## 配置

### 模型配置

模型配置文件位于 `~/.babyAgent/models.json`，支持多供应商多模型配置：

```json
{
  "providers": {
    "deepseek": {
      "baseUrl": "https://api.deepseek.com",
      "apiKey": "$DEEPSEEK_API_KEY",
      "models": [
        {
          "id": "deepseek-chat",
          "name": "DeepSeek Chat",
          "input": ["text"],
          "contextWindow": 1000000,
          "maxTokens": 8192,
          "cost": {
            "input": 0.14,
            "output": 0.28,
            "cacheRead": 0.014,
            "cacheWrite": 0.014
          }
        }
      ]
    }
  }
}
```

`apiKey` 字段支持 `$ENV_VAR_NAME` 或 `${ENV_VAR_NAME}` 语法从环境变量读取。首次运行时会自动创建默认配置文件。

### 环境变量

| 变量 | 必需 | 描述 |
|------|------|------|
| `DEEPSEEK_API_KEY` | 是（默认） | DeepSeek API 密钥 |
| `BABY_AGENT_LOG_LEVEL` | 否 | 日志级别（默认 debug） |
| `BABY_AGENT_LOG_DIR` | 否 | 日志文件目录 |

### MCP 服务器

在 `~/.babyAgent/mcp.json` 中配置 MCP 服务器：

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

支持 stdio 和 HTTP/SSE 两种传输方式。

### 系统提示词

系统提示词位于 `~/.babyAgent/system_prompt.md`，用于定义 AI 智能体的基础行为指令。首次运行时会自动创建默认文件。你可通过编辑此文件自定义智能体的行为。

### 技能

技能是包含 `SKILL.md` 文件（含 YAML 前置元数据）的目录：

```markdown
---
description: 处理特定类型任务的指令
name: my-skill
disable-model-invocation: false
---
... 技能指令内容 ...
```

技能可放置在以下位置：
- `~/.babyAgent/skills/`（用户级，跨项目可用）
- `.babyAgent/skills/`（项目级，同名技能会覆盖用户级）

## 脚本

| 脚本 | 描述 |
|------|------|
| `pnpm build` | TypeScript 类型检查 + esbuild 打包 |
| `pnpm clean` | 删除 `dist/` 目录 |
| `pnpm start` | 运行 CLI |
| `pnpm test` | 运行所有测试（vitest） |
| `pnpm test:watch` | 监听模式运行测试 |
| `pnpm verify:chat` | 快速聊天验证 |
| `pnpm verify:chat-stream` | 流式聊天验证 |
| `pnpm verify:chat-tools` | 工具调用验证 |
| `pnpm verify:chat-thinking` | 思考过程验证 |

## 技术栈

- **运行环境**：Node.js >= 18
- **编程语言**：TypeScript（ES2022，严格模式）
- **构建工具**：esbuild（打包）+ tsc（类型声明）
- **终端 UI**：@earendil-works/pi-tui（差分渲染框架）
- **LLM 供应商**：DeepSeek 及任意 OpenAI 兼容 API
- **MCP 协议**：@modelcontextprotocol/sdk
- **测试框架**：Vitest
- **代码检查**：Biome
- **包管理器**：pnpm
- **日志**：pino
- **许可证**：MIT

## 许可证

MIT
