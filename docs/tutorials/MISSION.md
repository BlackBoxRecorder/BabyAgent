# Mission: 构建一个 AI Agent

## Why
你正在开发 babyAgent 项目，需要深入理解每一块拼图是如何组合成完整 agent 的。从大模型 API 调用、SSE 流式解析、ReAct 多轮循环、工具注册与调用、MCP 集成，到 skill 系统和最终协调层——你想不仅能**用**这些代码，还能**从头解释和构建**一个 agent。

## Success looks like
- 能用自己的话解释 SSE 流式解析的每一行代码，并手写一个简易解析器
- 能独立实现一个 ReAct 推理-执行循环
- 能理解工具注册表的职责，并添加一个新工具
- 能解释 MCP 配置加载→传输层连接→工具适配的完整链路
- 能描述 skill 系统如何与系统提示词交互
- 能串联整个协调层的执行流：启动→接收输入→调用 LLM→处理工具结果→返回

## Constraints
- 学习材料基于现有 babyAgent 代码库，跟着代码学
- 每个 lesson 短小精悍，在 10-15 分钟内可完成

## Out of scope
- 大模型训练或微调原理
- 具体部署运维（Docker、K8s）
- 非 OpenAI 兼容的 LLM API 协议适配
