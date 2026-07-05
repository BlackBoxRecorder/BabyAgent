/// <reference types="node" />

/**
 * 验证脚本：流式对话
 *
 * 测试：逐 chunk 输出、最终 accumulated 聚合、[DONE] 信号
 *
 * 用法：npx tsx scripts/chat-stream.ts
 */

import {
  createClient,
  printSection,
  printKV,
  printElapsed,
} from "./_common.js";
import type { Message } from "../src/llm/index.js";

const client = createClient();

// ── 1. 基础流式对话 ────────────────────────────────────

async function basicStream() {
  printSection("1. 基础流式对话");

  const messages: Message[] = [
    { role: "user", content: "用三句话介绍人工智能。" },
  ];

  const start = Date.now();
  let chunkCount = 0;
  let streamedContent = "";

  for await (const chunk of client.chatStream(messages)) {
    chunkCount++;
    const delta = chunk.delta;

    // 实时打印增量内容
    if (delta.content) {
      streamedContent += delta.content;
      process.stdout.write(delta.content);
    }

    // 打印最终聚合结果
    if (chunk.accumulated) {
      printSection("聚合结果");
      printKV("chunks 总数", chunkCount);
      printKV("streamed_content", streamedContent);
      printKV("accumulated.content", chunk.accumulated.content);
      printKV("finish_reason", chunk.accumulated.finish_reason);
      if (chunk.accumulated.usage) {
        printKV(
          "usage",
          `prompt=${chunk.accumulated.usage.prompt_tokens} completion=${chunk.accumulated.usage.completion_tokens} total=${chunk.accumulated.usage.total_tokens}`,
        );
      }

      // 验证聚合内容与流式拼接内容一致
      if (streamedContent !== chunk.accumulated.content) {
        console.log("\n⚠️  WARNING: streamed content ≠ accumulated content!");
      } else {
        console.log("\n✅ streamed content 与 accumulated content 一致");
      }
    }
  }

  printElapsed(start);
}

// ── 2. 长文本流式对话 ────────────────────────────────────

async function longStream() {
  printSection("2. 长文本流式对话");

  const messages: Message[] = [
    { role: "user", content: "写一段约200字的短文描述春天的景色。" },
  ];

  const start = Date.now();
  let chunkCount = 0;

  for await (const chunk of client.chatStream(messages)) {
    chunkCount++;
    if (chunk.delta.content) {
      process.stdout.write(chunk.delta.content);
    }
    if (chunk.accumulated) {
      printSection("统计");
      printKV("chunks 总数", chunkCount);
      if (chunk.accumulated.usage) {
        printKV("total_tokens", chunk.accumulated.usage.total_tokens);
      }
    }
  }

  printElapsed(start);
}

// ── Main ────────────────────────────────────────────────

async function main() {
  console.log("🚀 LLM 流式对话验证\n");

  await basicStream();
  await longStream();

  console.log("\n✅ 流式对话验证完成");
}

main().catch((err) => {
  console.error("❌ 验证失败:", err.message);
  process.exit(1);
});
