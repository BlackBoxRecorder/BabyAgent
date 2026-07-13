# ADR-0003 实现方案：Agent 交互日志记录

## 1. 核心设计

### 1.1 日志配置
```typescript
interface LogConfig {
  enabled: boolean;              // 是否启用日志，默认 true
  level: LogLevel;               // 日志级别，默认 INFO
  dir: string;                   // 日志目录，默认 ~/.babyAgent/logs
  maxFileSize: number;           // 单文件最大大小 (bytes)，默认 10MB
  maxDays: number;               // 保留天数，默认 30
}
```

### 1.2 日志级别
```typescript
enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}
```

### 1.3 日志条目格式
```typescript
interface LogEntry {
  timestamp: string;              // ISO 8601
  level: LogLevel;
  component: 'agent' | 'coordinator' | 'session' | 'tool';
  event: string;                  // 事件类型
  sessionId?: string;             // 关联的会话 ID
  data?: Record<string, any>;     // 事件特定数据
  error?: string;                 // 错误信息
}
```

## 2. 文件结构

```
src/
└── logger/
    ├── index.ts                 # 导出 Logger 和配置
    ├── config.ts                # 配置管理
    ├── logger.ts                # Logger 类
    ├── transports/
    │   ├── file.ts              # 文件传输
    │   └── console.ts           # 控制台传输（可选）
    └── types.ts                 # 类型定义
```

## 3. Logger 类设计

### 3.1 核心方法
```typescript
class Logger {
  // 单例模式
  static getInstance(): Logger;
  
  // 配置方法
  configure(config: Partial<LogConfig>): void;
  
  // 日志方法
  error(component: string, event: string, data?: any, error?: Error): void;
  warn(component: string, event: string, data?: any): void;
  info(component: string, event: string, data?: any): void;
  debug(component: string, event: string, data?: any): void;
  
  // 会话相关
  setSessionId(sessionId: string | null): void;
  
  // 生命周期
  flush(): Promise<void>;
  close(): Promise<void>;
}
```

### 3.2 集成点

#### Agent 类集成
```typescript
// 在 agent.ts 中
import { Logger } from './logger/index.js';

export class Agent {
  private logger: Logger;
  
  constructor(config: AgentConfig) {
    this.logger = Logger.getInstance();
    // ...
  }
  
  async *runWithMessages(inputMessages: Message[]): AsyncGenerator<AgentStreamEvent, AgentResult> {
    this.logger.info('agent', 'llm_request', {
      model: this._currentModel,
      messageCount: inputMessages.length
    });
    
    // 记录 LLM 响应
    if (accumulatedResponse) {
      this.logger.info('agent', 'llm_response', {
        contentLength: accumulatedResponse.content?.length,
        toolCallCount: accumulatedResponse.tool_calls?.length
      });
    }
    
    // 记录工具调用
    for (const toolCall of accumulatedResponse.tool_calls) {
      this.logger.info('agent', 'tool_call', {
        tool: toolCall.function.name,
        arguments: toolCall.function.arguments
      });
    }
  }
}
```

#### Coordinator 类集成
```typescript
// 在 coordinator.ts 中
import { Logger } from './logger/index.js';

export class ConversationCoordinator {
  private logger: Logger;
  
  constructor(config: CoordinatorConfig) {
    this.logger = Logger.getInstance();
  }
  
  async *executeTurn(userInput: string, options?: ExecuteTurnOptions): AsyncGenerator<TurnEvent, void> {
    this.logger.info('coordinator', 'turn_start', {
      sessionId: this._sessionId,
      inputLength: userInput.length
    });
    
    // 记录会话创建
    if (this._sessionId === null) {
      const meta = await this.sessionManager.createSession(userInput);
      this.logger.info('coordinator', 'session_created', {
        sessionId: meta.id,
        title: meta.title
      });
    }
    
    // 记录错误
    if (agentErr) {
      this.logger.error('coordinator', 'agent_error', {
        error: errorMsg
      }, agentErr as Error);
    }
    
    // 记录轮次完成
    this.logger.info('coordinator', 'turn_complete', {
      sessionId: this._sessionId,
      usage: result.usage,
      billing: result.billing
    });
  }
}
```

## 4. 文件传输设计

### 4.1 文件组织
```
~/.babyAgent/logs/
├── 2026-07-05/
│   ├── session-abc123.log
│   └── session-def456.log
└── 2026-07-04/
    └── session-xyz789.log
```

### 4.2 写入策略
- 使用异步写入，不阻塞主流程
- 使用写入队列，防止并发写入冲突
- 达到最大文件大小时自动轮转
- 定期清理过期日志文件

### 4.3 性能优化
```typescript
class FileTransport {
  private writeQueue: LogEntry[] = [];
  private isWriting = false;
  
  async write(entry: LogEntry): Promise<void> {
    this.writeQueue.push(entry);
    
    if (!this.isWriting) {
      this.isWriting = true;
      await this.processQueue();
      this.isWriting = false;
    }
  }
  
  private async processQueue(): Promise<void> {
    while (this.writeQueue.length > 0) {
      const batch = this.writeQueue.splice(0, 100); // 批量写入
      await this.writeBatch(batch);
    }
  }
}
```

## 5. 配置管理

### 5.1 环境变量
```bash
BABY_AGENT_LOG_ENABLED=true
BABY_AGENT_LOG_LEVEL=INFO
BABY_AGENT_LOG_DIR=~/.babyAgent/logs
BABY_AGENT_LOG_MAX_SIZE=10485760  # 10MB
BABY_AGENT_LOG_MAX_DAYS=30
```

### 5.2 默认配置
```typescript
const DEFAULT_CONFIG: LogConfig = {
  enabled: true,
  level: LogLevel.INFO,
  dir: path.join(os.homedir(), '.babyAgent', 'logs'),
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxDays: 30
};
```

## 6. 事件类型定义

### 6.1 Agent 事件
- `llm_request`: LLM 请求
- `llm_response`: LLM 响应
- `tool_call`: 工具调用
- `tool_result`: 工具结果
- `iteration_start`: 迭代开始
- `iteration_end`: 迭代结束

### 6.2 Coordinator 事件
- `turn_start`: 轮次开始
- `turn_complete`: 轮次完成
- `turn_error`: 轮次错误
- `session_created`: 会话创建
- `session_resumed`: 会话恢复
- `session_saved`: 会话保存

### 6.3 错误事件
- `agent_error`: Agent 错误
- `save_error`: 保存错误
- `tool_error`: 工具错误
- `llm_error`: LLM 错误

## 7. 使用示例

### 7.1 基本使用
```typescript
import { Logger } from './logger/index.js';

const logger = Logger.getInstance();
logger.info('agent', 'startup', { version: '1.0.0' });
```

### 7.2 带会话 ID
```typescript
logger.setSessionId('session-abc123');
logger.info('coordinator', 'turn_start', { input: 'Hello' });
```

### 7.3 错误记录
```typescript
try {
  await someOperation();
} catch (error) {
  logger.error('agent', 'operation_failed', { 
    operation: 'someOperation' 
  }, error as Error);
}
```

## 8. 测试策略

### 8.1 单元测试
- 测试日志级别过滤
- 测试文件轮转
- 测试配置管理
- 测试异步写入

### 8.2 集成测试
- 测试与 Agent 集成
- 测试与 Coordinator 集成
- 测试会话 ID 关联

## 9. 后续扩展

### 9.1 可选功能
- 日志压缩 (gzip)
- 远程日志传输
- 日志分析工具
- 日志可视化

### 9.2 性能监控
- 写入延迟监控
- 文件大小监控
- 内存使用监控

## 10. 实施步骤

1. 创建 Logger 模块基础结构
2. 实现配置管理
3. 实现文件传输
4. 集成到 Agent 类
5. 集成到 Coordinator 类
6. 添加测试
7. 更新文档