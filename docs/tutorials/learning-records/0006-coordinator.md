# Lesson 6: 协调层

完成了全部 6 课的学习！最后一课理解了 Coordinator 和 AppFactory 如何将前 5 课的所有模块串联成一个完整的系统。

**关键收获：**
- Coordinator 是调度中枢：承上（CLI/TUI 显示层）启下（Agent + SessionManager 逻辑层）
- executeTurn() 是核心流程：自动创建 session → 组装消息 → Agent 执行（ReAct 循环）→ 流式事件 yield → 持久化保存
- AppFactory 是接线板：8 步组装（模型→工具→MCP→Skill→提示词→Agent→Coordinator），严格依赖顺序
- 错误恢复三部曲：保存错误 turn（防孤儿文件）→ 回滚消息历史 → yield agent_error 事件
- AsyncGenerator 流式事件传递：Coordinator 将 Agent 的 AgentStreamEvent 原样转给 CLI/TUI
- 会话生命周期：自动创建、持久化（.jsonl + .meta.json）、恢复、切换模型

**系统哲学：** 分层解耦，接口即契约——Tool 接口、AsyncGenerator 流式事件、SKILL.md 格式、MCP 协议，每个模块只依赖抽象不依赖实现。
