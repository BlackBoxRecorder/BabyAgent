# DeepSeek API 接口文档

> 基于 [DeepSeek 官方 API 文档](https://api-docs.deepseek.com/zh-cn/) 整理，涵盖对话补全、思考模式与多轮对话。

---

## 目录

- [1. 概述](#1-概述)
- [2. 对话补全 API](#2-对话补全-api)
  - [2.1 端点与认证](#21-端点与认证)
  - [2.2 请求参数](#22-请求参数)
  - [2.3 消息角色与结构](#23-消息角色与结构)
  - [2.4 非流式响应](#24-非流式响应)
  - [2.5 流式响应](#25-流式响应)
  - [2.6 代码示例](#26-代码示例)
- [3. 思考模式](#3-思考模式)
  - [3.1 概述](#31-概述)
  - [3.2 开关与强度控制](#32-开关与强度控制)
  - [3.3 参数限制](#33-参数限制)
  - [3.4 reasoning_content 处理规则](#34-reasoning_content-处理规则)
  - [3.5 多轮对话中的拼接](#35-多轮对话中的拼接)
  - [3.6 工具调用场景](#36-工具调用场景)
  - [3.7 代码示例](#37-代码示例)
- [4. 多轮对话](#4-多轮对话)
  - [4.1 无状态 API 原理](#41-无状态-api-原理)
  - [4.2 messages 拼接规则](#42-messages-拼接规则)
  - [4.3 与思考模式的结合](#43-与思考模式的结合)
  - [4.4 代码示例](#44-代码示例)
- [5. 工具调用](#5-工具调用)
  - [5.1 工具定义格式](#51-工具定义格式)
  - [5.2 工具调用流程](#52-工具调用流程)
  - [5.3 代码示例](#53-代码示例)
  - [5.4 Strict 模式（Beta）](#54-strict-模式beta)
    - [5.4.1 概述与启用](#541-概述与启用)
    - [5.4.2 支持的 JSON Schema 类型](#542-支持的-json-schema-类型)
    - [5.4.3 object 类型](#543-object-类型)
    - [5.4.4 string 类型](#544-string-类型)
    - [5.4.5 number / integer 类型](#545-number--integer-类型)
    - [5.4.6 array 类型](#546-array-类型)
    - [5.4.7 enum](#547-enum)
    - [5.4.8 anyOf](#548-anyof)
    - [5.4.9 $ref 和 $def](#549-ref-和-def)

---

## 1. 概述

DeepSeek API 提供兼容 OpenAI SDK 格式的大语言模型对话补全服务。主要特性：

- **Base URL**: `https://api.deepseek.com`
- **认证方式**: Bearer Token（在请求头中携带 `Authorization: Bearer <API Key>`）
- **内容类型**: `application/json`（请求与响应）
- **核心端点**: `POST /chat/completions` — 对话补全

支持的模型包括 `deepseek-v4-pro` 等（以官方最新公告为准）。

---

## 2. 对话补全 API

### 2.1 端点与认证

```
POST https://api.deepseek.com/chat/completions
Content-Type: application/json
Authorization: Bearer <your-api-key>
```

### 2.2 请求参数

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `messages` | `Array<Message>` | ✅ 是 | — | 对话消息数组，按时间顺序排列。详见 [2.3 消息角色与结构](#23-消息角色与结构) |
| `model` | `string` | ✅ 是 | — | 模型标识，例如 `"deepseek-v4-pro"` |
| `thinking` | `object` | 否 | `{ type: "enabled" }` | 思考模式开关。详见 [3. 思考模式](#3-思考模式) |
| `thinking.type` | `"enabled" \| "disabled"` | 否 | `"enabled"` | 启用或禁用思考模式 |
| `reasoning_effort` | `"low" \| "medium" \| "high" \| "max"` | 否 | `"high"` | 思考强度。`low`/`medium` 映射为 `high`，`xhigh` 映射为 `max`。详见 [3.2](#32-开关与强度控制) |
| `max_tokens` | `number` | 否 | `4096` | 模型输出的最大 token 数。包含 `content` 和 `reasoning_content` |
| `temperature` | `number` | 否 | `1` | 采样温度，范围 `(0, 2]`。**思考模式下不生效**（设置不报错但被忽略） |
| `top_p` | `number` | 否 | `1` | 核采样参数，范围 `(0, 1]`。**思考模式下不生效** |
| `tools` | `Array<Tool>` | 否 | — | 可用的工具/函数定义列表。详见 [5.1 工具定义格式](#51-工具定义格式) |
| `tool_choice` | `string \| object` | 否 | `"auto"` | 工具调用策略。<br>• `"none"` — 不调用工具<br>• `"auto"` — 模型自主决定<br>• `"required"` — 必须调用工具<br>• `{ type: "function", function: { name: "xxx" } }` — 强制调用指定工具 |
| `stream` | `boolean` | 否 | `false` | 是否启用流式输出（SSE 格式）。为 `true` 时响应为 `text/event-stream` |
| `user_id` | `string` | 否 | — | 用户标识，用于内容安全处理、KVCache 缓存隔离、调度隔离 |

> **注意**：使用 OpenAI SDK 时，`thinking` 参数需通过 `extra_body` 传入，而非放在顶层请求体中。

### 2.3 消息角色与结构

每条消息为一个对象，包含以下字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `role` | `"system" \| "user" \| "assistant" \| "tool"` | 消息角色 |
| `content` | `string` | 消息内容（文本） |
| `name` | `string`（可选） | 发送者名称，用于区分同一角色的不同参与者 |
| `tool_call_id` | `string`（仅 tool） | 工具调用 ID，仅 `role: "tool"` 时需要 |
| `tool_calls` | `Array<ToolCall>`（仅 assistant） | 模型发起的工具调用，仅 `role: "assistant"` 时可能包含 |
| `reasoning_content` | `string`（仅 assistant） | 思维链内容，思考模式下由模型返回。详见 [3.4](#34-reasoning_content-处理规则) |

**四种消息角色：**

- **system**: 系统提示词，通常放在 `messages` 数组的首位，用于设定模型行为、角色、规则。
- **user**: 用户消息，代表用户输入。
- **assistant**: 助手消息，代表模型的回复。多轮对话时需要将历史回复回传。
- **tool**: 工具执行结果消息，代表工具调用的返回值。

**消息结构示例：**

```json
[
  { "role": "system", "content": "You are a helpful assistant." },
  { "role": "user", "content": "What is the weather in Beijing?" },
  {
    "role": "assistant",
    "content": null,
    "tool_calls": [
      {
        "id": "call_abc123",
        "type": "function",
        "function": { "name": "get_weather", "arguments": "{\"location\": \"Beijing\"}" }
      }
    ]
  },
  { "role": "tool", "tool_call_id": "call_abc123", "content": "Sunny, 25°C" },
  { "role": "assistant", "content": "The weather in Beijing is sunny with a temperature of 25°C." }
]
```

### 2.4 非流式响应

当 `stream: false`（默认）时，API 返回一个完整的 JSON 对象。

**响应格式（`application/json`）：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 本次请求的唯一标识 |
| `object` | `"chat.completion"` | 对象类型，固定值 |
| `created` | `number` | 创建时间戳（Unix 秒） |
| `model` | `string` | 实际使用的模型标识 |
| `system_fingerprint` | `string` | 系统指纹，用于追踪后端配置 |
| `choices` | `Array<Choice>` | 模型生成的选项列表，通常只有一个 |
| `usage` | `Usage` | Token 使用统计 |

**Choice 结构：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `index` | `number` | 选项序号（从 0 开始） |
| `finish_reason` | `"stop" \| "tool_calls" \| "length" \| "content_filter"` | 结束原因：<br>• `"stop"` — 自然结束或触发了 stop 序列<br>• `"tool_calls"` — 模型请求调用工具<br>• `"length"` — 达到 `max_tokens` 上限<br>• `"content_filter"` — 内容被过滤 |
| `message` | `Message` | 模型返回的消息，包含 `role`、`content`、`reasoning_content`（思考模式）、`tool_calls`（工具调用） |
| `logprobs` | `Logprobs`（可选） | Token 级别的对数概率信息 |

**Usage 结构：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `prompt_tokens` | `number` | 输入消耗的 token 数 |
| `completion_tokens` | `number` | 输出消耗的 token 数 |
| `total_tokens` | `number` | 总 token 数（= prompt_tokens + completion_tokens） |
| `prompt_cache_hit_tokens` | `number` | 命中缓存的输入 token 数 |
| `prompt_cache_miss_tokens` | `number` | 未命中缓存的输入 token 数 |
| `completion_tokens_details` | `object` | 输出 token 的详细信息 |
| `completion_tokens_details.reasoning_tokens` | `number` | 思维链消耗的 token 数（思考模式下） |

**完整响应示例：**

```json
{
  "id": "930c60df-bf64-41c9-a88e-3ec75f81e00e",
  "choices": [
    {
      "finish_reason": "stop",
      "index": 0,
      "message": {
        "content": "Hello! How can I help you today?",
        "role": "assistant"
      }
    }
  ],
  "created": 1705651092,
  "model": "deepseek-v4-pro",
  "object": "chat.completion",
  "usage": {
    "completion_tokens": 10,
    "prompt_tokens": 16,
    "total_tokens": 26
  }
}
```

### 2.5 流式响应

当 `stream: true` 时，API 返回 SSE（Server-Sent Events）格式的流式数据。

**响应格式（`text/event-stream`）：**

每个数据块以 `data: ` 开头，内容为 JSON 对象（`chat.completion.chunk`）。流结束标志为 `data: [DONE]`。

**Chunk 结构：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 请求唯一标识 |
| `object` | `"chat.completion.chunk"` | 对象类型 |
| `created` | `number` | 创建时间戳 |
| `model` | `string` | 模型标识 |
| `system_fingerprint` | `string` | 系统指纹 |
| `choices[0].index` | `number` | 序号 |
| `choices[0].delta` | `Delta` | 增量内容，与 `message` 结构一致但字段均为可选 |
| `choices[0].delta.role` | `string` | 仅首个 chunk 包含 |
| `choices[0].delta.content` | `string` | 增量文本内容 |
| `choices[0].delta.reasoning_content` | `string` | 增量思维链内容（思考模式） |
| `choices[0].delta.tool_calls` | `Array` | 增量工具调用（分片返回） |
| `choices[0].finish_reason` | `string \| null` | 仅在最后一个 chunk 有值 |
| `usage` | `Usage \| null` | 仅在最后一个 chunk 包含 token 统计 |

**流式响应示例：**

```
data: {"id":"1f633d8bfc...","choices":[{"index":0,"delta":{"content":"","role":"assistant"},"finish_reason":null}],"created":1718345013,"model":"deepseek-v4-pro","object":"chat.completion.chunk"}

data: {"id":"1f633d8bfc...","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}],"created":1718345013,"model":"deepseek-v4-pro","object":"chat.completion.chunk"}

data: {"id":"1f633d8bfc...","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}],"created":1718345013,"model":"deepseek-v4-pro","object":"chat.completion.chunk"}

data: {"id":"1f633d8bfc...","choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}],"created":1718345013,"model":"deepseek-v4-pro","object":"chat.completion.chunk","usage":{"completion_tokens":9,"prompt_tokens":17,"total_tokens":26}}

data: [DONE]
```

### 2.6 代码示例

#### 非流式调用

```typescript
const API_KEY = "<your-api-key>";
const BASE_URL = "https://api.deepseek.com";

const response = await fetch(`${BASE_URL}/chat/completions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  },
  body: JSON.stringify({
    model: "deepseek-v4-pro",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello! Who are you?" },
    ],
    max_tokens: 4096,
    temperature: 1,
    top_p: 1,
    stream: false,
  }),
  signal: AbortSignal.timeout(60000),
});

if (!response.ok) {
  throw new Error(`DeepSeek API error (${response.status}): ${await response.text()}`);
}

const data = await response.json();
const choice = data.choices[0];
console.log("Response:", choice.message.content);
console.log("Tokens used:", data.usage.total_tokens);
```

#### 流式调用

```typescript
const API_KEY = "<your-api-key>";
const BASE_URL = "https://api.deepseek.com";

const response = await fetch(`${BASE_URL}/chat/completions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  },
  body: JSON.stringify({
    model: "deepseek-v4-pro",
    messages: [
      { role: "user", content: "Tell me a short story." },
    ],
    stream: true,
  }),
});

const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("data: ")) continue;

    const data = trimmed.slice(6); // Remove "data: " prefix
    if (data === "[DONE]") {
      console.log("\n--- Stream finished ---");
      break;
    }

    try {
      const parsed = JSON.parse(data);
      const delta = parsed.choices?.[0]?.delta;
      if (delta?.content) {
        process.stdout.write(delta.content); // Print incrementally
      }
      if (parsed.usage) {
        console.log(`\nTokens: ${parsed.usage.total_tokens}`);
      }
    } catch {
      // Skip malformed chunks
    }
  }
}
```

---

## 3. 思考模式

### 3.1 概述

DeepSeek 模型支持**思考模式（Thinking Mode）**：在输出最终回答之前，模型会先生成一段**思维链内容（reasoning_content）**，以提升答案的准确性。这类似于模型在"思考"过程中展示推理步骤。

核心概念：
- **思维链（reasoning_content）**：模型在输出最终回答前的内部推理过程，API 通过 `reasoning_content` 字段返回
- **最终回答（content）**：思考完成后输出的正式回复

### 3.2 开关与强度控制

**思考模式开关：**

通过 `thinking` 参数控制：

| 参数路径 | 取值 | 说明 |
|---|---|---|
| `thinking.type` | `"enabled"` | 启用思考模式（**默认**） |
| `thinking.type` | `"disabled"` | 禁用思考模式 |

**思考强度控制：**

通过 `reasoning_effort` 参数控制思考深度：

| 取值 | 说明 |
|---|---|
| `"low"` | 低强度（**兼容映射为 `high`**） |
| `"medium"` | 中强度（**兼容映射为 `high`**） |
| `"high"` | 高强度（默认值，适用于普通请求） |
| `"max"` | 最高强度（适用于复杂 Agent 类请求，如 Claude Code、OpenCode） |

> **注意**：
> - 对普通请求，默认 effort 为 `high`
> - 对一些复杂 Agent 类请求（如 Claude Code、OpenCode），effort 自动设置为 `max`
> - 出于兼容考虑，`low`、`medium` 会被映射为 `high`，`xhigh` 会被映射为 `max`

**OpenAI SDK 用户注意**：`thinking` 参数不属于 OpenAI SDK 标准字段，需要通过 `extra_body` 传入：

```python
response = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=messages,
    reasoning_effort="high",
    extra_body={"thinking": {"type": "enabled"}}
)
```

在原生 REST API 中，`thinking` 直接放在请求体顶层：

```json
{
  "model": "deepseek-v4-pro",
  "messages": [...],
  "thinking": { "type": "enabled" },
  "reasoning_effort": "high"
}
```

### 3.3 参数限制

在思考模式（`thinking.type: "enabled"`）下，以下采样参数**不生效**：

- `temperature`
- `top_p`
- `presence_penalty`
- `frequency_penalty`

> 设置这些参数不会报错，但会被 API 忽略。这是为了确保思维链推理过程的确定性。

### 3.4 reasoning_content 处理规则

`reasoning_content` 是思考模式的核心产物，其处理规则取决于是否涉及工具调用：

#### 规则 1：无工具调用 — 下一轮无需回传

在两个 `user` 消息之间，如果模型**未进行工具调用**，则中间 assistant 的 `reasoning_content` **无需**参与上下文拼接。即使将其传入后续请求的 `messages` 中，API 也会忽略。

```
Round 1:
  user: "9.11 and 9.8, which is greater?"
  assistant: { reasoning_content: "Let me compare...", content: "9.11 > 9.8" }

Round 2:
  # reasoning_content from Round 1 is NOT needed
  messages: [
    { role: "user", content: "9.11 and 9.8, which is greater?" },
    { role: "assistant", content: "9.11 > 9.8" },  // Only content, no reasoning_content
    { role: "user", content: "How many R in 'strawberry'?" }
  ]
```

#### 规则 2：有工具调用 — 必须回传

在两个 `user` 消息之间，如果模型**进行了工具调用**，则中间所有 assistant 的 `reasoning_content` **必须**完整回传给 API，贯穿该轮的所有子请求。如果在后续请求中未正确回传，API 会返回 **400 错误**。

详见 [3.6 工具调用场景](#36-工具调用场景)。

### 3.5 多轮对话中的拼接

在每一轮对话中，模型会输出 `reasoning_content` 和 `content`。拼接规则取决于是否有工具调用：

**无工具调用的多轮对话：**

```
Turn 1:  user → assistant (reasoning + content)
Turn 2:  messages = [user_t1, assistant_t1_without_reasoning, user_t2]
```

之前轮次的 `reasoning_content` 不被拼接到后续轮次的上下文中。模型每轮独立进行思考。

**有工具调用的多轮对话：**

详见 [3.6 工具调用场景](#36-工具调用场景)，其拼接规则更为严格。

### 3.6 工具调用场景

思考模式完全支持工具调用。模型可以在一次请求中经历多轮"思考 → 工具调用 → 获取结果 → 继续思考"的循环，直到给出最终答案。

**关键规则：在进行了工具调用的轮次中，每一个子请求都必须携带该轮产生的 `reasoning_content`。**

具体拼接逻辑：

```
Turn 1:
  Sub-turn 1.1: user → assistant (reasoning_1 + tool_call for get_date)
    → messages: [user, assistant(with reasoning_1 + tool_call)]
  
  Sub-turn 1.2: tool_result + reasoning_1 → assistant (reasoning_2 + tool_call for get_weather)
    → messages: [user, assistant(with reasoning_1 + tool_call), tool_result, assistant(with reasoning_2 + tool_call)]
  
  Sub-turn 1.3: tool_result + reasoning_2 → assistant (reasoning_3 + content)
    → messages: [user, assistant(with reasoning_1 + tool_call), tool_result, assistant(with reasoning_2 + tool_call), tool_result, assistant(with reasoning_3 + content)]

Turn 2 (new user question):
  → 必须携带 Turn 1 所有 assistant 消息中的 reasoning_content
  → messages: [user_t1, assistant(with reasoning_1 + tool_call), tool_result, assistant(with reasoning_2 + tool_call), tool_result, assistant(with reasoning_3 + content), user_t2]
```

> **重要**：如果后续请求中缺少任何进行了工具调用的轮次的 `reasoning_content`，API 将返回 400 错误。

### 3.7 代码示例

#### 基础思考模式（非流式）

```typescript
const messages = [
  { role: "user", content: "9.11 and 9.8, which is greater?" }
];

// Round 1
const response1 = await fetch("https://api.deepseek.com/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  },
  body: JSON.stringify({
    model: "deepseek-v4-pro",
    messages,
    thinking: { type: "enabled" },
    reasoning_effort: "high",
  }),
});

const data1 = await response1.json();
const msg1 = data1.choices[0].message;
console.log("Reasoning:", msg1.reasoning_content);
console.log("Answer:", msg1.content);

// Round 2 — reasoning_content from Round 1 is NOT needed (no tool calls)
messages.push({ role: "assistant", content: msg1.content }); // Only content
messages.push({ role: "user", content: "How many R in 'strawberry'?" });

const response2 = await fetch("https://api.deepseek.com/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  },
  body: JSON.stringify({
    model: "deepseek-v4-pro",
    messages,
    thinking: { type: "enabled" },
    reasoning_effort: "high",
  }),
});
```

#### 流式思考模式

```typescript
const messages = [
  { role: "user", content: "9.11 and 9.8, which is greater?" }
];

const response = await fetch("https://api.deepseek.com/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  },
  body: JSON.stringify({
    model: "deepseek-v4-pro",
    messages,
    thinking: { type: "enabled" },
    reasoning_effort: "high",
    stream: true,
  }),
});

let reasoningContent = "";
let content = "";

const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ") || trimmed === "data: [DONE]") continue;

    const parsed = JSON.parse(trimmed.slice(6));
    const delta = parsed.choices?.[0]?.delta;

    if (delta?.reasoning_content) {
      reasoningContent += delta.reasoning_content;
    }
    if (delta?.content) {
      content += delta.content;
    }
  }
}

console.log("Reasoning:", reasoningContent);
console.log("Content:", content);

// Round 2 — only pass content, not reasoning_content
messages.push({ role: "assistant", content });
```

#### 思考模式 + 工具调用

```typescript
// Tool definitions
const tools = [
  {
    type: "function",
    function: {
      name: "get_date",
      description: "Get the current date",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get weather of a location",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "City name" },
          date: { type: "string", description: "Date in YYYY-mm-dd" },
        },
        required: ["location", "date"],
      },
    },
  },
];

// Tool implementations
const toolExecutor: Record<string, Function> = {
  get_date: () => new Date().toISOString().slice(0, 10),
  get_weather: (args: { location: string; date: string }) =>
    `Cloudy 7~13°C in ${args.location} on ${args.date}`,
};

const messages: Array<Record<string, any>> = [
  { role: "user", content: "How's the weather in Hangzhou tomorrow?" },
];

async function runTurn(messages: Array<Record<string, any>>) {
  let subTurn = 1;
  while (true) {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-v4-pro",
        messages,
        tools,
        thinking: { type: "enabled" },
        reasoning_effort: "high",
      }),
    });

    const data = await response.json();
    const msg = data.choices[0].message;

    // IMPORTANT: Pass the entire message (including reasoning_content, content, tool_calls) back
    messages.push(msg);

    console.log(`Sub-turn ${subTurn}:`);
    console.log("  reasoning:", msg.reasoning_content?.slice(0, 100) + "...");
    console.log("  content:", msg.content);
    console.log("  tool_calls:", msg.tool_calls ? "yes" : "none");

    // If no tool calls, model has finished answering
    if (!msg.tool_calls) break;

    // Execute tool calls and add results to messages
    for (const toolCall of msg.tool_calls) {
      const fn = toolExecutor[toolCall.function.name];
      const args = JSON.parse(toolCall.function.arguments);
      const result = fn(args);
      console.log(`  tool result (${toolCall.function.name}):`, result);

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
    subTurn++;
  }
}

// Turn 1
await runTurn(messages);

// Turn 2 — Turn 1's messages (including all reasoning_content) are carried forward
messages.push({
  role: "user",
  content: "How's the weather in Guangzhou tomorrow?",
});
await runTurn(messages);
```

---

## 4. 多轮对话

### 4.1 无状态 API 原理

DeepSeek `/chat/completions` API 是一个**无状态（stateless）API**，即：

> **服务端不记录任何用户请求的上下文。每次请求都需要客户端将完整对话历史通过 `messages` 参数传递给 API。**

这意味着维护对话上下文的职责完全在客户端。每当用户发送新消息时，客户端需要：
1. 将之前所有对话历史（user + assistant 消息）拼接好
2. 将新的用户消息追加到末尾
3. 将完整 `messages` 数组发送给 API

### 4.2 messages 拼接规则

以下是多轮对话中 `messages` 数组的拼接方式：

**第 1 轮：**

```json
[
  { "role": "user", "content": "What's the highest mountain in the world?" }
]
```

模型返回：

```json
{
  "role": "assistant",
  "content": "The highest mountain in the world is Mount Everest."
}
```

**第 2 轮拼接：**

```
旧 messages ← [user_round1, assistant_round1]
旧 messages ← 追加新的 user_round2
最终 messages = [user_round1, assistant_round1, user_round2]
```

即：

```json
[
  { "role": "user", "content": "What's the highest mountain in the world?" },
  { "role": "assistant", "content": "The highest mountain in the world is Mount Everest." },
  { "role": "user", "content": "What is the second?" }
]
```

**通用拼接算法：**

```typescript
// messages 是该对话的全部历史
const messages: Message[] = [];

// Round 1: 首次提问
messages.push({ role: "user", content: "Hello!" });
const response1 = await chatCompletion(messages);
messages.push(response1.choices[0].message); // 追加 assistant 消息

// Round 2: 追加新问题
messages.push({ role: "user", content: "How are you?" });
const response2 = await chatCompletion(messages);
messages.push(response2.choices[0].message);

// Round N: 始终将完整 messages 传给 API
```

### 4.3 与思考模式的结合

当多轮对话与思考模式结合使用时，需要注意 [3.4 reasoning_content 处理规则](#34-reasoning_content-处理规则)：

| 场景 | reasoning_content 处理 |
|---|---|
| 未进行工具调用的轮次 | 下一轮中**不需要**传入 `reasoning_content`，仅传 `content` 即可 |
| 进行了工具调用的轮次 | 所有后续轮次中**必须**完整携带 `reasoning_content` |

**最佳实践**：简单起见，每次追加 assistant 消息时，可以始终使用完整的 `response.choices[0].message` 对象（包含所有字段），而非仅保留 `content`。对于未进行工具调用的轮次，API 会自动忽略多余的 `reasoning_content`。

### 4.4 代码示例

```typescript
const API_KEY = "<your-api-key>";
const BASE_URL = "https://api.deepseek.com";

async function chatCompletion(messages: Array<Record<string, any>>) {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-pro",
      messages,
      max_tokens: 4096,
    }),
  });
  return response.json();
}

// 对话状态由客户端维护
const messages: Array<Record<string, any>> = [
  { role: "system", content: "You are a helpful geography assistant." },
];

// Round 1
messages.push({ role: "user", content: "What's the highest mountain in the world?" });
const data1 = await chatCompletion(messages);
messages.push(data1.choices[0].message);
console.log("Assistant:", data1.choices[0].message.content);

// Round 2 — 完整 messages 自动携带历史
messages.push({ role: "user", content: "What is the second?" });
const data2 = await chatCompletion(messages);
messages.push(data2.choices[0].message);
console.log("Assistant:", data2.choices[0].message.content);

// Round 3
messages.push({ role: "user", content: "Are there any in South America?" });
const data3 = await chatCompletion(messages);
messages.push(data3.choices[0].message);
console.log("Assistant:", data3.choices[0].message.content);
```

---

## 5. 工具调用

### 5.1 工具定义格式

通过 `tools` 参数向模型注册可用的函数/工具。每个工具的 Schema 遵循 JSON Schema 规范。

```json
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "description": "Get weather of a location",
    "parameters": {
      "type": "object",
      "properties": {
        "location": {
          "type": "string",
          "description": "The city name, e.g. Beijing, Shanghai"
        },
        "date": {
          "type": "string",
          "description": "The date in YYYY-mm-dd format"
        }
      },
      "required": ["location", "date"]
    }
  }
}
```

**字段说明：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | `"function"` | ✅ 是 | 工具类型，目前仅支持 `function` |
| `function.name` | `string` | ✅ 是 | 函数名称，模型会在 tool_calls 中引用此名称 |
| `function.description` | `string` | 强烈建议 | 函数描述，帮助模型理解何时调用 |
| `function.parameters` | `object` | 否 | JSON Schema 格式的参数定义 |

### 5.2 工具调用流程

典型的工具调用流程如下：

```
1. Client → API: [user消息, tools定义]
2. API → Client: assistant消息（finish_reason="tool_calls"，包含 tool_calls 数组）
3. Client: 解析 tool_calls，调用本地函数获取结果
4. Client → API: [原始messages, assistant(with tool_calls), tool消息(tool_call_id + 结果)]
5. API → Client: assistant消息（可能继续 tool_calls 或给出最终回答 finish_reason="stop"）
```

**tool_choice 参数控制模型何时调用工具：**

| 值 | 行为 |
|---|---|
| `"auto"`（默认） | 模型自主决定是否调用工具 |
| `"none"` | 禁止调用任何工具 |
| `"required"` | 强制至少调用一个工具 |
| `{ type: "function", function: { name: "xxx" } }` | 强制调用指定工具 |

**非思考模式 vs 思考模式：**

| 模式 | 说明 |
|---|---|
| **非思考模式** | 标准工具调用，模型直接输出 tool_calls 或最终回答。执行流程简洁，适合简单的工具调用场景 |
| **思考模式** | 模型在调用工具前先进行推理（输出 `reasoning_content`），可进行多轮思考+调用循环。`reasoning_content` 必须正确回传（详见 [3.6](#36-工具调用场景)）。从 DeepSeek-V3.2 开始支持 |

### 5.3 代码示例

```typescript
const API_KEY = "<your-api-key>";
const BASE_URL = "https://api.deepseek.com";

// Define tools
const tools = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather for a city",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "City name" },
        },
        required: ["location"],
      },
    },
  },
];

// Mock tool executor
function getWeather(location: string): string {
  const weathers: Record<string, string> = {
    beijing: "Sunny, 25°C",
    shanghai: "Cloudy, 22°C",
    guangzhou: "Rainy, 28°C",
  };
  return weathers[location.toLowerCase()] || "Unknown location";
}

const messages: Array<Record<string, any>> = [
  { role: "user", content: "What's the weather in Beijing?" },
];

let iteration = 0;
const MAX_ITERATIONS = 5; // Prevent infinite loops

while (iteration < MAX_ITERATIONS) {
  iteration++;

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-pro",
      messages,
      tools,
      tool_choice: "auto",
    }),
  });

  const data = await response.json();
  const msg = data.choices[0].message;

  // Append assistant message to history
  messages.push(msg);

  // If model produced a final answer (no tool calls), exit loop
  if (!msg.tool_calls) {
    console.log("Final answer:", msg.content);
    break;
  }

  // Process each tool call
  for (const toolCall of msg.tool_calls) {
    const fnName = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments);

    console.log(`Calling tool: ${fnName}(${JSON.stringify(args)})`);

    // Execute the function
    const result = fnName === "get_weather" ? getWeather(args.location) : "";
    console.log(`Tool result: ${result}`);

    // Append tool result to messages
    messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: result,
    });
  }
}
```

**思考模式 + 工具调用的注意事项**：参见 [3.6 工具调用场景](#36-工具调用场景) 中关于 `reasoning_content` 必须回传的规则。

### 5.4 Strict 模式（Beta）

#### 5.4.1 概述与启用

在 **strict 模式**下，模型在输出 Function 调用时会严格遵循 Function 的 JSON Schema 格式要求，确保模型输出的参数结构完全符合你的定义。无论是思考模式还是非思考模式下的工具调用，均可使用 strict 模式。

**启用 strict 模式需要满足以下条件：**

1. **使用 Beta 端点**：将 `base_url` 设置为 `https://api.deepseek.com/beta`
2. **设置 strict 属性**：在传入的 `tools` 列表中，每个 `function` 均需设置 `"strict": true`
3. **Schema 合规**：服务端会校验 JSON Schema，不符合规范或使用了不支持的 Schema 类型时将返回错误

**strict 模式下的工具定义样例：**

```json
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "strict": true,
    "description": "Get weather of a location, the user should supply a location first.",
    "parameters": {
      "type": "object",
      "properties": {
        "location": {
          "type": "string",
          "description": "The city and state, e.g. San Francisco, CA"
        }
      },
      "required": ["location"],
      "additionalProperties": false
    }
  }
}
```

**TypeScript 调用示例（strict 模式）：**

```typescript
const response = await fetch("https://api.deepseek.com/beta/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  },
  body: JSON.stringify({
    model: "deepseek-v4-pro",
    messages: [{ role: "user", content: "What's the weather in Beijing?" }],
    tools: [
      {
        type: "function",
        function: {
          name: "get_weather",
          strict: true,
          description: "Get weather of a location",
          parameters: {
            type: "object",
            properties: {
              location: { type: "string", description: "City name" },
              unit: {
                type: "string",
                enum: ["celsius", "fahrenheit"],
                description: "Temperature unit",
              },
            },
            required: ["location", "unit"],
            additionalProperties: false,
          },
        },
      },
    ],
  }),
});
```

#### 5.4.2 支持的 JSON Schema 类型

strict 模式支持以下 JSON Schema 类型：

| 类型 | 说明 |
|---|---|
| `object` | 键值对结构，所有属性必须放入 `required`，且 `additionalProperties` 必须为 `false` |
| `string` | 字符串，支持 `pattern`（正则）和 `format`（email/hostname/ipv4/ipv6/uuid） |
| `number` | 数字，支持 `const`、`default`、`minimum`、`maximum`、`exclusiveMinimum`、`exclusiveMaximum`、`multipleOf` |
| `integer` | 整数，与 `number` 支持的参数相同 |
| `boolean` | 布尔值 |
| `array` | 数组，需通过 `items` 指定元素 schema |
| `enum` | 枚举，确保输出为预设选项之一 |
| `anyOf` | 匹配多个 schema 中的任意一个 |

> **提示**：strict 模式还支持通过 `$ref` 和 `$def` 实现 schema 的模块化与复用。

#### 5.4.3 object 类型

`object` 定义一个包含键值对的深层结构。

**约束规则：**
- `properties` 定义每个键（属性）的 schema
- 所有属性均需放入 `required` 数组
- `additionalProperties` 必须设为 `false`

**示例：**

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "age": { "type": "integer" }
  },
  "required": ["name", "age"],
  "additionalProperties": false
}
```

#### 5.4.4 string 类型

**支持的参数：**

| 参数 | 说明 |
|---|---|
| `pattern` | 正则表达式，约束字符串格式（如 `"^\\d{6}$"` 匹配 6 位数字） |
| `format` | 预定义格式校验，支持：`email`（邮箱）、`hostname`（主机名）、`ipv4`（IPv4 地址）、`ipv6`（IPv6 地址）、`uuid`（UUID） |

**不支持的参数：** `minLength`、`maxLength`

**示例：**

```json
{
  "type": "object",
  "properties": {
    "user_email": {
      "type": "string",
      "description": "The user's email address",
      "format": "email"
    },
    "zip_code": {
      "type": "string",
      "description": "Six digit postal code",
      "pattern": "^\\d{6}$"
    }
  }
}
```

#### 5.4.5 number / integer 类型

**支持的参数：**

| 参数 | 说明 |
|---|---|
| `const` | 固定为某个常数 |
| `default` | 默认值 |
| `minimum` | 最小值（≥） |
| `maximum` | 最大值（≤） |
| `exclusiveMinimum` | 不小于（>） |
| `exclusiveMaximum` | 不大于（<） |
| `multipleOf` | 输出为指定值的倍数 |

**示例：**

```json
{
  "type": "object",
  "properties": {
    "score": {
      "type": "integer",
      "description": "A number from 1-5, which represents your rating, the higher, the better",
      "minimum": 1,
      "maximum": 5
    }
  },
  "required": ["score"],
  "additionalProperties": false
}
```

#### 5.4.6 array 类型

**不支持的参数：** `minItems`、`maxItems`

**示例：**

```json
{
  "type": "object",
  "properties": {
    "keywords": {
      "type": "array",
      "description": "Five keywords of the article, sorted by importance",
      "items": {
        "type": "string",
        "description": "A concise and accurate keyword or phrase."
      }
    }
  },
  "required": ["keywords"],
  "additionalProperties": false
}
```

#### 5.4.7 enum

`enum` 确保模型输出为预设选项之一，适用于有限状态的场景（如订单状态、分类标签）。

**示例：**

```json
{
  "type": "object",
  "properties": {
    "order_status": {
      "type": "string",
      "description": "Ordering status",
      "enum": ["pending", "processing", "shipped", "cancelled"]
    }
  }
}
```

#### 5.4.8 anyOf

`anyOf` 匹配多个 schema 中的任意一个，适用于字段可能有多种合法格式的场景。

**示例 — 账户可以是邮箱或手机号：**

```json
{
  "type": "object",
  "properties": {
    "account": {
      "anyOf": [
        { "type": "string", "format": "email", "description": "可以是电子邮件地址" },
        { "type": "string", "pattern": "^\\d{11}$", "description": "或11位手机号码" }
      ]
    }
  }
}
```

#### 5.4.9 $ref 和 $def

可以使用 `$def` 定义可复用的 schema 模块，再通过 `$ref` 引用，以减少重复并能模块化管理 schema。此外，`$ref` 还可用于定义递归结构。

**示例 — 使用 $def/$ref 复用作者信息结构：**

```json
{
  "type": "object",
  "properties": {
    "report_date": {
      "type": "string",
      "description": "The date when the report was published"
    },
    "authors": {
      "type": "array",
      "description": "The authors of the report",
      "items": {
        "$ref": "#/$def/author"
      }
    }
  },
  "required": ["report_date", "authors"],
  "additionalProperties": false,
  "$def": {
    "author": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "author's name"
        },
        "institution": {
          "type": "string",
          "description": "author's institution"
        },
        "email": {
          "type": "string",
          "format": "email",
          "description": "author's email"
        }
      },
      "additionalProperties": false,
      "required": ["name", "institution", "email"]
    }
  }
}
```

---

## 附录：错误处理

### 常见 HTTP 状态码

| 状态码 | 说明 |
|---|---|
| `200` | 请求成功 |
| `400` | 请求参数错误（如 `reasoning_content` 缺失、消息格式不合法） |
| `401` | 认证失败（API Key 无效或过期） |
| `429` | 请求频率超限（触发限速） |
| `500` | 服务器内部错误 |

### 错误响应格式

```json
{
  "error": {
    "message": "Invalid API key provided",
    "type": "invalid_request_error"
  }
}
```

### 超时建议

建议设置请求超时时间（如 60 秒），尤其在使用思考模式或流式输出时。

```typescript
signal: AbortSignal.timeout(60000) // 60 seconds
```

---

## 附录：TypeScript 类型定义参考

项目中 `@deepCode/llm` 包提供了完整的 TypeScript 类型定义，可在实际开发中直接引用：

```typescript
// 消息角色
export type MessageRole = "system" | "user" | "assistant" | "tool";

// 单条消息
export interface Message {
  role: MessageRole;
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

// 工具调用
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

// LLM 响应
export interface LLMResponse {
  content: string | null;
  tool_calls?: ToolCall[];
  finish_reason: "stop" | "tool_calls" | "length";
  reasoning_content?: string;
}

// 请求配置
export interface DeepSeekRequestConfig {
  model?: string;
  thinking?: { type: "enabled" | "disabled" };
  reasoning_effort?: "low" | "medium" | "high";
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  tool_choice?: "none" | "auto" | "required";
  stream?: boolean;
}
```

参见项目源码：[packages/llm/src/index.ts](../../packages/llm/src/index.ts)
