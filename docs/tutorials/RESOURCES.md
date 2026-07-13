# Agent 构建 Resources

## Knowledge

- [Source Code: babyAgent `src/`](file:///Users/yinnan/data/code/agent/babyAgent/src/)
  核心参考——所有 lesson 的示例代码均来自此目录。按模块组织：`llm/`（API 调用），`agent.ts`（ReAct 循环），`tools/`（工具系统），`mcp/`（MCP 集成），`skills.ts`（技能管理），`coordinator.ts`（协调层）。
- [SSE 日志: `sse.log`](file:///Users/yinnan/data/code/agent/babyAgent/sse.log)
  真实大模型流式输出的完整日志。包含 reasoning_content（推理过程）和 content（最终回答）的逐 chunk 示例，以及最后的 `finish_reason` 和 `[DONE]` 标记。
- [OpenAI Chat Completions API 文档](https://platform.openai.com/docs/api-reference/chat)
  SSE 流式格式的标准参考。`data: ` 前缀、`[DONE]` 终止、delta 结构、finish_reason 枚举均源自此规范。
- [MCP 规范 (Model Context Protocol)](https://spec.modelcontextprotocol.io/)
  MCP 传输层、工具发现、工具调用的官方协议规范。
- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)
  ReAct 模式的原论文——推理与行动协同增强大模型能力。
- [TypeScript MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)
  MCP 客户端和服务端的官方 TypeScript SDK。

## Wisdom (Communities)

- [Anthropic Cookbook](https://github.com/anthropics/anthropic-cookbook)
  实用的 agent 实现范例，包含 tool use 和 function calling 的参考实现。
- [OpenAI Cookbook](https://cookbook.openai.com/)
  官方 cookbook，涵盖 function calling、streaming 等常见模式的 Python/Node 示例。

## Gaps

- 大模型计费模型细化：目前本代码库使用 `ModelCost` 中的 cost 乘数计算，但不同 provider 计费公式差异大，缺少统一的计费接口文档。
