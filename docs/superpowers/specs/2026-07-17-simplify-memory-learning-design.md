# 精简 Memory & Learning 系统

## 目标

当前 memory (`src/memory.ts`, 631 行) 和 learning (`src/learning.ts`, 600 行) 系统功能重叠、大部分功能未被使用（三层架构、命名空间、corrections、heartbeat、结构化日志等），需要大刀阔斧地精简。

只保留最核心的能力：跨会话记住用户偏好，注入 system prompt。

## 保留

### MemoryManager — 缩减到 ~50 行

仅提供以下 API：

- `load()` — 读取 `~/.babyAgent/memory.md`，返回 `string[]`
- `save(items)` — 写入 `~/.babyAgent/memory.md`
- `addMemory(text)` — 追加一条（去重），保存
- `getMemory()` — 返回格式化文本（给 system prompt 用）

存储格式保持不变：
```markdown
# Memory
- Use Chinese
- Keep answers concise
```

### CLI 命令

- `/remember <content>` — 记住一条偏好
- `记住 <content>` — 自然语言等价命令

### Coordinator 集成

会话创建时（`newSession`），将 memory 注入到 system prompt 末尾（现有逻辑保留）。

## 删除

| 文件 | 操作 |
|------|------|
| `src/learning.ts` | 整个文件删除 |
| `src/memory.ts` | 删除：三层架构(HOT/WARM/COLD)、命名空间系统(Namespace/NamespaceScope)、CorrectionEntry 修正日志、index.md/heartbeat-state.md、search/forget/getStats/getMemoryText/loadHotMemory/loadNamespace/confirmCorrection/addCorrection 等方法，以及所有复杂的 `_parse`/`_write`/`_group` 私有方法。保留：load/save/addMemory/getMemory + 基础读写 |
| `src/cli/command.ts` | 删除：`/memory stats/show/forget/search`、`/learn list/add`、`/errors list`、`/features list` 命令处理逻辑及 LearningManager/MemoryManager 多余 import。保留：`/remember`/`记住` 处理 |
| `tests/agent/memory.test.ts` | 精简：只测 load/save/addMemory/getMemory |
| `docs/adr/0008-tiered-memory-and-self-improvement.md` | 标记为废弃（或归档） |
| `docs/memory/` 目录下文件 | 不再被生产和引用 |

## 不涉及

- `src/coordinator.ts` 中的记忆注入逻辑保持不变（只需确认编译通过）
- `src/session.ts` 不涉及
- `src/agent.ts` 不涉及

## 预期结果

- `src/memory.ts`：631 行 → ~50 行
- `src/learning.ts`：删除 (600 行)
- `src/cli/command.ts`：减少 ~60 行
- 总代码减少约 **1200 行**
- 运行时文件：仅 `~/.babyAgent/memory.md` 一个文件
- 不再有 `.learnings/`、`memory/` 子目录等复杂结构
