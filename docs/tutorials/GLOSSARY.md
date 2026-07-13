# Agent 构建 Glossary

核心术语，用于所有 lesson 和参考文档中。

## 通用概念

**SSE (Server-Sent Events)**:
服务端通过 HTTP 长连接向客户端推送事件的协议。每个事件以 `data: ` 开头、`\n\n` 结束。在 LLM 场景中用于流式输出推理结果。
_避免_: WebSocket, 轮询

**ReAct (Reasoning + Acting)**:
大模型"推理→执行→再推理→再执行"的循环模式。模型输出思考过程和行动指令，系统执行行动并将结果反馈，直到模型输出最终答案。
_避免_: Agent loop, function calling（这些虽相关但不等同）

**Tool Call (工具调用)**:
LLM 返回的特殊响应格式，包含工具名称和参数字符串，指示系统执行外部函数。
_避免_: Function call, action

**finish_reason**:
LLM 响应中的结束原因字段，可以是 `stop`（正常结束）、`tool_calls`（需要调用工具）、`length`（达到最大 token）。
_避免_: done, complete

## 架构组件

**System Prompt**:
系统级提示词，在对话开始时注入，定义 agent 的行为、可用工具和技能。消息角色为 `system`。
_避免_: Instructions, pre-prompt

**Message**:
对话消息，按 `role`（system/user/assistant/tool）区分类型。每种角色有特定字段约束。
_避免_: Turn entry, chat item

**LLM Client**:
封装大模型 HTTP API 调用的客户端，处理流式响应解析、超时、token 用量统计和计费。
_避免_: Model client, AI service

**Tool Registry**:
工具注册表，管理所有可用工具的注册、查找和 LLM 格式转换。
_避免_: Tool store, action registry

**MCP (Model Context Protocol)**:
标准化的 tool server 协议，允许 LLM agent 通过统一接口发现和调用外部工具。支持 stdio 和 HTTP/SSE 两种传输层。
_避免_: Plugin system, extension

## 执行流程

**Chat Completions**:
OpenAI 兼容的 `/chat/completions` 端点，接收 messages 数组，返回模型生成的回复或工具调用。
_避免_: Completion, generation endpoint

**Streaming**:
以 SSE 方式逐 chunk 接收 LLM 输出，每个 chunk 包含增量 delta（content/reasoning_content/tool_calls）。
_避免_: Real-time output

**Turn**:
一次完整的用户输入→agent 处理→最终输出（可能包含多轮 LLM 调用+工具执行）的周期。
_避免_: Round, interaction

**Coordinator**:
协调层，管理 session 生命周期和 turn 执行，在 Agent（逻辑层）和 CLI/TUI（展示层）之间架桥。
_避免_: Controller, orchestrator
