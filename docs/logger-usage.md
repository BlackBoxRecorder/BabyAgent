# Logger 使用指南

## 概述

babyAgent 的日志系统用于记录大模型输出和 agent 交互，帮助调试、分析和审计。日志默认存储在 `~/.babyAgent/logs/` 目录下。

## 配置

### 环境变量

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `BABY_AGENT_LOG_ENABLED` | 是否启用日志 | `true` |
| `BABY_AGENT_LOG_LEVEL` | 日志级别 (ERROR/WARN/INFO/DEBUG) | `INFO` |
| `BABY_AGENT_LOG_DIR` | 日志目录 | `~/.babyAgent/logs` |
| `BABY_AGENT_LOG_MAX_SIZE` | 单文件最大大小 (bytes) | `10485760` (10MB) |
| `BABY_AGENT_LOG_MAX_DAYS` | 保留天数 | `30` |
| `BABY_AGENT_LOG_CONSOLE` | 是否输出到控制台 | `false` |

### 配置示例

```bash
# 启用调试日志
export BABY_AGENT_LOG_LEVEL=DEBUG

# 启用控制台输出
export BABY_AGENT_LOG_CONSOLE=true

# 自定义日志目录
export BABY_AGENT_LOG_DIR=/var/log/babyAgent
```

## 日志文件结构

```
~/.babyAgent/logs/
├── 2026-07-05/
│   ├── session-abc123.log
│   ├── session-def456.log
│   └── global.log
├── 2026-07-04/
│   └── session-xyz789.log
└── ...
```

- 每天一个目录，格式为 `YYYY-MM-DD`
- 每个会话一个日志文件，格式为 `session-{sessionId}.log`
- 没有关联会话的日志记录在 `global.log` 中

## 日志格式

每条日志是一个 JSON 行：

```json
{
  "timestamp": "2026-07-05T14:30:00.000Z",
  "level": "INFO",
  "component": "agent",
  "event": "llm_request",
  "sessionId": "abc123",
  "data": {
    "model": "deepseek-chat",
    "messageCount": 5,
    "toolCount": 3
  }
}
```

## 日志级别

| 级别 | 说明 |
|------|------|
| `ERROR` | 错误和异常 |
| `WARN` | 警告信息 |
| `INFO` | 关键事件（LLM 调用、工具执行、会话事件） |
| `DEBUG` | 详细调试信息 |

## 记录的事件

### Agent 事件

| 事件 | 说明 |
|------|------|
| `initialized` | Agent 初始化完成 |
| `run_start` | 开始运行 |
| `iteration_start` | 迭代开始 |
| `llm_request` | 发送 LLM 请求 |
| `llm_response` | 收到 LLM 响应 |
| `llm_no_response` | LLM 无响应 |
| `tool_call` | 调用工具 |
| `tool_not_found` | 工具未找到 |
| `tool_result` | 工具执行完成 |
| `tool_error` | 工具执行错误 |
| `max_iterations_reached` | 达到最大迭代次数 |

### Coordinator 事件

| 事件 | 说明 |
|------|------|
| `initialized` | Coordinator 初始化完成 |
| `turn_start` | 轮次开始 |
| `turn_complete` | 轮次完成 |
| `turn_aborted` | 轮次中止 |
| `turn_save_error` | 轮次保存错误 |
| `session_created` | 会话创建 |
| `session_resume_start` | 开始恢复会话 |
| `session_resumed` | 会话恢复完成 |
| `session_not_found` | 会话未找到 |
| `session_ambiguous` | 会话 ID 不唯一 |
| `new_session` | 新建会话 |
| `agent_error` | Agent 错误 |
| `save_error` | 保存错误 |
| `error_turn_saved` | 错误轮次已保存 |

## 使用示例

### 基本使用

```typescript
import { getLogger } from './logger/index.js';

const logger = getLogger();
logger.info('my-component', 'startup', { version: '1.0.0' });
logger.error('my-component', 'operation_failed', { operation: 'fetch' }, new Error('Network error'));
```

### 在类中使用

```typescript
import { getLogger } from './logger/index.js';

export class MyService {
  private logger = getLogger();

  constructor() {
    this.logger.info('my-service', 'initialized');
  }

  async doSomething(): Promise<void> {
    this.logger.debug('my-service', 'do_something_start');
    // ... 业务逻辑
    this.logger.info('my-service', 'do_something_complete');
  }
}
```

### 设置会话 ID

```typescript
const logger = getLogger();
logger.setSessionId('session-abc123');
logger.info('coordinator', 'turn_start'); // 自动关联到会话
```

## 查询日志

### 查看特定会话的日志

```bash
# 查看今天的会话日志
cat ~/.babyAgent/logs/2026-07-05/session-abc123.log

# 查看所有日志
find ~/.babyAgent/logs -name "*.log" -exec cat {} \;
```

### 使用 jq 分析日志

```bash
# 查看所有错误
cat ~/.babyAgent/logs/**/*.log | jq 'select(.level == "ERROR")'

# 查看特定事件
cat ~/.babyAgent/logs/**/*.log | jq 'select(.event == "llm_request")'

# 统计工具调用
cat ~/.babyAgent/logs/**/*.log | jq 'select(.event == "tool_call") | .data.tool' | sort | uniq -c
```

## 最佳实践

1. **生产环境**: 使用默认配置 (`INFO` 级别，不输出到控制台)
2. **开发环境**: 设置 `BABY_AGENT_LOG_LEVEL=DEBUG` 和 `BABY_AGENT_LOG_CONSOLE=true`
3. **调试问题**: 临时启用 `DEBUG` 级别，问题解决后恢复 `INFO`
4. **磁盘空间**: 定期检查 `~/.babyAgent/logs/` 目录大小，配置合理的 `maxDays`

## 故障排除

### 日志文件未创建

1. 检查 `BABY_AGENT_LOG_ENABLED` 是否为 `true`
2. 检查 `BABY_AGENT_LOG_DIR` 目录权限
3. 检查磁盘空间是否充足

### 日志内容不完整

1. 检查 `BABY_AGENT_LOG_LEVEL` 设置
2. 检查是否有未捕获的异常
3. 确保在程序退出前调用 `logger.flush()`

### 性能问题

1. 日志写入是异步的，不会阻塞主流程
2. 如果日志量过大，考虑提高日志级别
3. 避免在循环中记录大量 `DEBUG` 日志