# Lesson 2: ReAct 推理-执行循环

完成了第 2 课 ReAct 循环的学习。理解了 Agent 如何通过 while 循环在 LLM 调用和工具执行之间反复切换，直到得到最终回答。

**关键收获：**
- ReAct = Reasoning + Acting，核心是"思考→行动→再思考"的循环
- `finish_reason` 决定循环走向：`stop` 结束，`tool_calls` 执行工具后继续
- 工具结果通过 `role: "tool"` 消息加入对话，让 LLM"看到"执行结果
- 所有工具异常都被 try-catch 兜底，不会中断 agent 循环——LLM 可以基于错误信息自我修正
- 消息结构演进：`[system, user, assistant(tool_calls), tool(result), ...]` → 下一轮 LLM 调用
- `AgentStreamEvent` 将三种事件（chunk / tool_result / done）通过 yield 暴露给展示层

**对后续学习的影响：** ReAct 循环中调用的工具来自 ToolRegistry，下一课将深入工具的接口定义和具体实现。
