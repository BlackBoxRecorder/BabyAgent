# SSE 流式响应解析：从二进制 chunk 到结构化数据

## 背景

在 LLM 聊天补全场景中，主流模型供应商（OpenAI、Anthropic、Google 等）都支持 **SSE（Server-Sent Events）** 协议来流式返回结果。客户端收到一个事件流，每个事件携带一小段增量数据（delta），最终拼装成完整的回复内容。

> 本文基于项目中的 `src/llm/llm.ts` 实现，分析完整的 SSE 解析流程。

## 整体流程概览

```
TCP 流 → ReadableStream → buffer 拼装 → \n 切分行 → 解析 data: → JSON.parse → yield delta
```

核心挑战：**TCP 底层返回的是二进制 chunk，一次 read 可能包含半行、一行或多行，需要自行处理粘包和截断问题。**

---

## 第一步：从字节流到字符串（二进制解码）

```ts
const reader = response.body!.getReader();
const decoder = new TextDecoder();

// 循环读取
const { done, value } = await reader.read();
buffer += decoder.decode(value, { stream: true });
```

- `response.body.getReader()` — 获取响应体的 `ReadableStream` 读取器
- `TextDecoder` — 把 `Uint8Array` 二进制数据解码为字符串
- `{ stream: true }` — 告诉解码器流尚未结束，让它内部处理好**多字节字符跨 chunk 截断**的问题。例如一个 UTF-8 中文字符占 3 个字节，如果上一个 chunk 末尾只有 2 个字节，`stream: true` 会让解码器缓存这 2 个字节，等下一个 chunk 的剩余字节到达后再一起解码

---

## 第二步：buffer 粘包处理

```ts
buffer += decoder.decode(value, { stream: true });
const lines = buffer.split("\n");
buffer = lines.pop() || "";
```

这是最精妙的设计，用一个**行缓冲区**解决跨 chunk 的行截断问题：

### 为什么需要 buffer？

SSE 协议中每行数据以 `\n` 分隔，比如：

```
data: {"hello":"world"}\n
data: {"foo":"bar"}\n
```

但底层 TCP 流不会按照 `\n` 边界返回数据，一次 `reader.read()` 可能返回：

```
chunk 1: 'data: {"hel'          ← 半行
chunk 2: 'lo":"world"}\ndata:'  ← 包含一整行 + 下一行的前半
chunk 3: ' {"foo":"bar"}\n'     ← 完整行
```

### buffer 的运作机制

| 步骤 | 操作 | buffer 内容 | lines 数组 |
|------|------|------------|-----------|
| 初始 | — | `""` | — |
| chunk1 到达 | 拼入后 split | `data: {"hel` | `["data: {"hel"]` |
| | pop 最后一段回 buffer | `data: {"hel` | `[]`（无完整行） |
| chunk2 到达 | `buffer + chunk2` = `data: {"hello":"world"}\ndata:` | — | — |
| | split | — | `["data: {\"hello\":\"world\"}", "data:"]` |
| | pop 最后一段回 buffer | `data:` | `["data: {\"hello\":\"world\"}"]` ✅ 可以解析 |
| chunk3 到达 | `buffer + chunk3` = `data: {"foo":"bar"}\n` | — | — |
| | split | — | `["data: {\"foo\":\"bar\"}", ""]` |
| | pop 空字符串，buffer=`""` | `""` | `["data: {\"foo\":\"bar\"}"]` ✅ 可以解析 |

**核心思想**：每一轮只处理以 `\n` 结尾的**完整行**。不完整的残余段留在 buffer 中，等下一轮 chunk 到达时拼接完整再处理。

---

## 第三步：过滤 SSE 行

```ts
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("data: ")) continue;
```

- 跳过空行：`!trimmed`
- 跳过非 `data:` 前缀的行：SSE 协议可能包含 `event:`、`id:`、`retry:` 等字段，我们只关心 `data:` 事件
- `trim()` 去除可能的空白字符

---

## 第四步：提取 JSON 主体

```ts
const data = trimmed.slice(6);  // 去掉 "data: " 前缀
if (data === "[DONE]") {
  // 流结束标记
  yield { delta: {}, finish_reason, usage, accumulated };
  return;
}
```

- `slice(6)` 去掉前 6 个字符 `"data: "`
- `[DONE]` 是 OpenAI 约定的流结束标记，遇到直接返回最终汇总结果

---

## 第五步：JSON 解析与增量累加

```ts
try {
  const parsed = JSON.parse(data);
  const choice = parsed.choices?.[0];
  const delta = choice?.delta;

  if (delta?.content) content += delta.content;
  if (delta?.reasoning_content) reasoningContent += delta.reasoning_content;
  if (delta?.tool_calls) { /* 累加工具调用 */ }
  if (choice?.finish_reason) finishReason = choice.finish_reason;
  if (parsed.usage) { /* 记录 token 用量 */ }

  yield { delta: { content, reasoning_content, tool_calls }, finish_reason };
} catch {
  // Skip malformed JSON chunks
}
```

`data` 的内容是一个符合 OpenAI chat completion chunk 格式的 JSON：

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion.chunk",
  "created": 1712345678,
  "model": "gpt-4",
  "choices": [{
    "index": 0,
    "delta": { "content": "世界" },
    "finish_reason": null
  }]
}
```

JSON.parse 解析后，提取 `choices[0].delta` —— 它包含本次的增量字段：
- `content` — 文本增量
- `reasoning_content` — 推理/思维链增量（部分模型支持）
- `tool_calls` — 工具调用增量（名称和参数是流式拼接的）

`yield` 将每次 delta 作为 `LLMStreamChunk` 返回，调用方（如 `coordinator.ts`）可以逐块处理。

---

## 异常安全

```ts
try {
  const parsed = JSON.parse(data);
  // ...
} catch {
  // Skip malformed JSON chunks
}
```

两层保障确保异常不会导致流中断：

1. **行完整性**：`buffer.split("\n")` + `lines.pop()` 保证只有完整行才会进入解析，正常情况下 `data: ` 后面的 JSON 是完整的
2. **try-catch 兜底**：即使某家 LLM 供应商返回了格式异常的 SSE 数据，解析异常会被静默跳过，不会破坏整个流

---

## 完整流程图

```
         ┌─────────────────────────────────┐
         │      ReadableStream reader      │
         │        reader.read()            │
         └────────────┬────────────────────┘
                      │ { done, value }
                      ▼
         ┌─────────────────────────────────┐
         │  decoder.decode(value, {stream}) │  ← 二进制→字符串
         └────────────┬────────────────────┘
                      │ 解码后的字符串
                      ▼
         ┌─────────────────────────────────┐
         │  buffer += decoded_string        │  ← 拼入缓冲区
         │  lines = buffer.split("\n")      │  ← 按行切分
         │  buffer = lines.pop()            │  ← 不完整行回存
         └────────────┬────────────────────┘
                      │ lines（完整行数组）
                      ▼
         ┌─────────────────────────────────┐
         │  对每行: trim()                  │
         │  跳过空行 / 非 "data:" 行        │
         └────────────┬────────────────────┘
                      │ "data: {...}"
                      ▼
         ┌─────────────────────────────────┐
         │  data = trimmed.slice(6)         │  ← 去掉 "data: "
         │  if data === "[DONE]" → return   │
         └────────────┬────────────────────┘
                      │ JSON 字符串
                      ▼
         ┌─────────────────────────────────┐
         │  JSON.parse(data)                │
         │  choices[0].delta → 增量字段     │
         │  累加 content / tool_calls       │
         │  yield LLMStreamChunk            │
         └────────────┬────────────────────┘
                      │
              ┌───────┴───────┐
              │               │
              ▼               ▼
      继续读取          流结束 / [DONE]
                         yield 最终汇总
```

---

## 总结

| 组件 | 职责 |
|------|------|
| `TextDecoder` | 二进制 → UTF-8 字符串，处理多字节字符跨 chunk |
| `buffer` | 行缓冲区，暂存不完整行以处理粘包 |
| `split("\n")` + `pop()` | 切分出完整行，残余段回存 buffer |
| `startsWith("data: ")` | 过滤 SSE 事件类型 |
| `slice(6)` | 提取 JSON 主体 |
| `JSON.parse` + try-catch | 解析 JSON，异常跳过 |
| `yield` | 每次返回增量 delta |
| 字段累加 | content、reasoning_content、tool_calls 逐块拼接 |
