# Lesson 1: SSE 流式解析

完成了第一课 SSE 流式解析的学习。理解了 SSE 协议的基本格式（`data: ` 前缀、`[DONE]` 终止、`\n\n` 分隔）、LLM 流式 chunk 的结构（delta 包含 content / reasoning_content / tool_calls）、以及 ChatClient 缓冲读取和逐 chunk 累加的实现。

**关键收获：**
- SSE 不是 WebSocket，是单向 HTTP 长连接
- Buffer 技巧处理 TCP 分片：保留不完整的最后一行，下次拼接
- Tool call 的 `index` 字段用于区分并行工具调用
- `finish_reason` 决定了 agent 的下一步行为（stop / tool_calls / length）
- 最后一个 chunk 携带完整的 `usage` 和累加的 `fullResponse`

**对后续学习的影响：** 理解 SSE 解析是理解 ReAct 循环的前提——agent 需要从流式结果中识别是"回答结束"还是"需要调用工具"，从而决定下一步行动。
