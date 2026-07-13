/// <reference types="node" />

/**
 * 验证脚本：思考模式
 *
 * 测试：reasoning_content 输出（非流式 + 流式）
 *
 * 用法：npx tsx scripts/chat-thinking.ts
 */

import {
  createClient,
  printSection,
  printKV,
  printElapsed,
} from "./_common.js";
import type { Message, LLMResponse } from "../src/llm/index.js";

const client = await createClient();

// ── 1. 非流式思考模式 ──────────────────────────────────

async function thinkingNonStream() {
  printSection("1. 非流式思考模式");

  const messages: Message[] = [
    { role: "user", content: "9.11 和 9.8 哪个更大？请逐步推理。" },
  ];

  const start = Date.now();
  let res: LLMResponse | undefined;
  for await (const chunk of client.chatStream(messages, undefined)) {
    if (chunk.fullResponse) {
      res = chunk.fullResponse;
    }
  }
  printElapsed(start);

  printKV("finish_reason", res!.finish_reason);
  if (res!.reasoning_content) {
    printKV("reasoning_content 长度", `${res!.reasoning_content.length} 字符`);
    console.log(`\n--- reasoning_content (前 300 字符) ---`);
    console.log(res!.reasoning_content.slice(0, 300));
  } else {
    console.log("⚠️  未收到 reasoning_content");
  }
  printKV(
    "content",
    res!.content?.slice(0, 200) +
      (res!.content && res!.content.length > 200 ? "..." : ""),
  );
}

// ── 2. 流式思考模式 ────────────────────────────────────

async function thinkingStream() {
  printSection("2. 流式思考模式");

  const messages: Message[] = [
    { role: "user", content: "strawberry 这个单词里有几个 r？请逐步推理。" },
  ];

  const start = Date.now();
  let reasoningContent = "";
  let content = "";
  let chunkCount = 0;

  for await (const chunk of client.chatStream(messages, undefined)) {
    chunkCount++;

    if (chunk.delta.reasoning_content) {
      reasoningContent += chunk.delta.reasoning_content;
    }
    if (chunk.delta.content) {
      content += chunk.delta.content;
    }

    if (chunk.fullResponse) {
      printKV("chunks 总数", chunkCount);

      // 验证聚合 reasoning_content
      if (chunk.fullResponse.reasoning_content) {
        printKV(
          "accumulated.reasoning_content 长度",
          `${chunk.fullResponse.reasoning_content.length} 字符`,
        );
        const matchAccum =
          reasoningContent === chunk.fullResponse.reasoning_content;
        console.log(
          `reasoning 增量拼接 与 accumulated 一致: ${matchAccum ? "✅" : "⚠️ 不一致!"}`,
        );
      }

      // 验证聚合 content
      const matchContent = content === (chunk.fullResponse.content ?? "");
      console.log(
        `content 增量拼接 与 accumulated 一致: ${matchContent ? "✅" : "⚠️ 不一致!"}`,
      );

      printKV(
        "accumulated.content",
        chunk.fullResponse.content?.slice(0, 200) ?? "(null)",
      );
    }
  }

  printElapsed(start);
}

// ── 3. 禁用思考模式对比 ────────────────────────────────

async function thinkingDisabled() {
  printSection("3. 禁用思考模式 (对比)");

  const messages: Message[] = [
    { role: "user", content: "9.11 和 9.8 哪个更大？" },
  ];

  const start = Date.now();
  let res: LLMResponse | undefined;
  for await (const chunk of client.chatStream(messages, undefined)) {
    if (chunk.fullResponse) {
      res = chunk.fullResponse;
    }
  }
  printElapsed(start);

  printKV("finish_reason", res!.finish_reason);
  printKV(
    "reasoning_content",
    res!.reasoning_content
      ? `存在 (${res!.reasoning_content.length} 字符)`
      : "无 (正确，已禁用)",
  );
  printKV("content", res!.content);
}

// ── Main ────────────────────────────────────────────────

async function main() {
  console.log("🚀 LLM 思考模式验证\n");

  await thinkingNonStream();
  await thinkingStream();
  await thinkingDisabled();

  console.log("\n✅ 思考模式验证完成");
}

main().catch((err) => {
  console.error("❌ 验证失败:", err.message);
  process.exit(1);
});
