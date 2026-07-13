# Lesson 4: MCP 集成

完成了第 4 课 MCP 集成的学习。理解了 MCP 协议如何通过标准化的工具服务器接口扩展 agent 能力。

**关键收获：**
- MCP 定义了两个核心操作：tools/list（发现工具）和 tools/call（调用工具）
- 两种传输模式：stdio（子进程通信）和 HTTP/SSE（远程服务），通过配置文件的 command / url 字段区分
- `McpManager.loadAllTools()` 的 5 步流程：加载配置 → 创建传输 → 连接 → 列出工具 → 适配为 Tool
- `adaptMcpTool()` 是适配器模式的核心：MCP 工具 → 项目 Tool 接口，实现双向解耦
- 工具名带服务器名前缀（如 `playwright_browser_navigate`），避免命名冲突
- 优雅降级：单个 MCP 服务器失败不影响其他服务器和 agent 启动
- 内容提取：MCP 支持多种 content 类型（text、image、audio、resource），只提取 text 供 LLM 消费

**对后续学习的影响：** MCP 和自定义工具通过统一的 Tool 接口进入系统。第 5 课 Skill 系统则是在 prompt 层面让 agent 知道何时使用这些工具。
