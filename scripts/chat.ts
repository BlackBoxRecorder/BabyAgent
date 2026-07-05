/// <reference types="node" />

/**
 * 验证脚本：非流式对话
 *
 * 测试：简单对话、多轮对话、响应字段完整性
 *
 * 用法：npx tsx scripts/chat.ts
 */

import {
  createClient,
  printSection,
  printKV,
  printJSON,
  printElapsed,
} from "./_common.js";
import type { Message, LLMResponse } from "../src/llm/index.js";

const client = createClient();

// ── 1. 简单单轮对话 ────────────────────────────────────

async function simpleChat() {
  printSection("1. 简单单轮对话");

  const messages: Message[] = [{ role: "user", content: "用一句话介绍北京。" }];

  const start = Date.now();
  let res: LLMResponse | undefined;
  for await (const chunk of client.chatStream(messages)) {
    if (chunk.accumulated) {
      res = chunk.accumulated;
    }
  }
  printElapsed(start);

  printKV("content", res!.content);
  printKV("finish_reason", res!.finish_reason);
  if (res!.usage) {
    printKV(
      "usage",
      `prompt=${res!.usage.prompt_tokens} completion=${res!.usage.completion_tokens} total=${res!.usage.total_tokens}`,
    );
  }
}

// ── 2. 多轮对话 ────────────────────────────────────────

async function multiTurnChat() {
  printSection("2. 多轮对话");

  const messages: Message[] = [
    { role: "user", content: "中国最高的山是什么？" },
  ];

  const start = Date.now();

  // Turn 1
  let res1: LLMResponse | undefined;
  for await (const chunk of client.chatStream(messages)) {
    if (chunk.accumulated) {
      res1 = chunk.accumulated;
    }
  }
  messages.push({ role: "assistant", content: res1!.content! });

  // Turn 2
  messages.push({ role: "user", content: "它有多高？" });
  let res2: LLMResponse | undefined;
  for await (const chunk of client.chatStream(messages)) {
    if (chunk.accumulated) {
      res2 = chunk.accumulated;
    }
  }
  messages.push({ role: "assistant", content: res2!.content! });

  printElapsed(start);

  console.log(`\nTurn 1: ${res1!.content}`);
  console.log(`Turn 2: ${res2!.content}`);
  if (res2!.usage) {
    printKV("total_tokens", res2!.usage.total_tokens);
  }
}

// ── 3. System 消息 ──────────────────────────────────────

async function systemPromptChat() {
  printSection("3. System 提示词");

  const messages: Message[] = [
    {
      role: "system",
      content: "你是一个只讲冷笑话的助手，回复必须包含一个冷笑话。",
    },
    { role: "user", content: "讲个笑话。" },
  ];

  const start = Date.now();
  let res: LLMResponse | undefined;
  for await (const chunk of client.chatStream(messages)) {
    if (chunk.accumulated) {
      res = chunk.accumulated;
    }
  }
  printElapsed(start);

  printKV("content", res!.content);
  printKV("finish_reason", res!.finish_reason);
}

// ── Main ────────────────────────────────────────────────

async function main() {
  console.log("🚀 LLM 非流式对话验证\n");

  await simpleChat();
  await multiTurnChat();
  await systemPromptChat();

  console.log("\n✅ 非流式对话验证完成");
}

main().catch((err) => {
  console.error("❌ 验证失败:", err.message);
  process.exit(1);
});
