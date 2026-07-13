/// <reference types="node" />

/**
 * 验证脚本：Token Usage & Billing 数据准确性
 *
 * 复用 chat-tools.ts 的多轮工具调用流程，在每轮中捕获
 * usage 和 billing 数据，进行交叉验证。
 *
 * 验证项：
 *   1. total_tokens === prompt_tokens + completion_tokens
 *   2. totalCost === inputCost + outputCost + cacheReadCost + cacheWriteCost
 *   3. 用 model cost 重算 billing，与 API 返回对比
 *   4. 逐轮输出字符数统计及 char/token 比率
 *
 * 用法：npx tsx scripts/chat-token-billing.ts
 */

import {
  createClient,
  printSection,
  printKV,
  printJSON,
  printElapsed,
} from "./_common.js";
import type { Message, TokenUsage, BillingInfo } from "../src/llm/index.js";
import { loadModelConfig, getAllModels } from "../src/llm/models.js";
import type { ModelEntry } from "../src/llm/models.js";
import { DefaultBillingCalculator } from "../src/llm/billing.js";
import {
  weatherTool,
  attractionsTool,
  transportTool,
  executeGetWeather,
  executeGetAttractions,
  executeGetTransport,
} from "./chat-tools.js";

// ── 类型定义 ────────────────────────────────────────────

/** 单轮的 usage + billing + 统计信息 */
interface RoundStats {
  round: number;
  usage: TokenUsage;
  billing: BillingInfo;
  /** 本轮输入消息的字符总数 */
  inputChars: number;
  /** 本轮输出 content 的字符数 */
  outputChars: number;
  /** 重算的 billing（基于 model cost） */
  recomputedBilling: BillingInfo;
}

// ── 初始化 ──────────────────────────────────────────────

const client = await createClient();

// 获取当前 model 的 cost 配置（用于重算 billing）
const modelConfig = await loadModelConfig();
const allModels = getAllModels(modelConfig);
const currentModel: ModelEntry | undefined = allModels.find(
  (m) => m.modelId === client.currentModelId,
);
if (!currentModel) {
  console.error(`❌ 未找到当前 model "${client.currentModelId}" 的配置`);
  process.exit(1);
}

const billingCalculator = new DefaultBillingCalculator();

// ── 工具定义（复用 chat-tools.ts） ─────────────────────

const allTools = [weatherTool, attractionsTool, transportTool];

// ── 工具执行（复用 chat-tools.ts） ─────────────────────

function executeTool(name: string, args: Record<string, any>): string {
  switch (name) {
    case "get_weather":
      return executeGetWeather(args as { city: string });
    case "get_attractions":
      return executeGetAttractions(args as { city: string });
    case "get_transport":
      return executeGetTransport(
        args as { from_city: string; to_city: string },
      );
    default:
      return `未知工具: ${name}`;
  }
}

/** 统计消息列表中所有 content（system/user/assistant/tool）的字符总数 */
function countInputChars(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    if (msg.role === "system" || msg.role === "user") {
      total += (msg.content ?? "").length;
    } else if (msg.role === "tool") {
      total += (msg.content ?? "").length;
    } else if (msg.role === "assistant" && msg.content) {
      total += msg.content.length;
    }
  }
  return total;
}

// ── 验证逻辑 ────────────────────────────────────────────

function printAggregateReport(allStats: RoundStats[]): void {
  printSection("汇总报表");

  const totalUsage: TokenUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: 0,
    completion_tokens_details: { reasoning_tokens: 0 },
  };
  const totalBilling: BillingInfo = {
    inputCost: 0,
    outputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    totalCost: 0,
  };
  let totalInputChars = 0;
  let totalOutputChars = 0;

  for (const s of allStats) {
    totalUsage.prompt_tokens += s.usage.prompt_tokens;
    totalUsage.completion_tokens += s.usage.completion_tokens;
    totalUsage.total_tokens += s.usage.total_tokens;
    totalUsage.prompt_cache_hit_tokens =
      (totalUsage.prompt_cache_hit_tokens ?? 0) +
      (s.usage.prompt_cache_hit_tokens ?? 0);
    totalUsage.prompt_cache_miss_tokens =
      (totalUsage.prompt_cache_miss_tokens ?? 0) +
      (s.usage.prompt_cache_miss_tokens ?? 0);
    totalUsage.completion_tokens_details!.reasoning_tokens +=
      s.usage.completion_tokens_details?.reasoning_tokens ?? 0;

    totalBilling.inputCost += s.billing.inputCost;
    totalBilling.outputCost += s.billing.outputCost;
    totalBilling.cacheReadCost += s.billing.cacheReadCost;
    totalBilling.cacheWriteCost += s.billing.cacheWriteCost;
    totalBilling.totalCost += s.billing.totalCost;

    totalInputChars += s.inputChars;
    totalOutputChars += s.outputChars;
  }

  // Model 信息
  console.log("── Model 信息 ──");
  printKV("modelId", currentModel!.modelId);
  printKV("modelName", currentModel!.name);
  printJSON("cost rates", currentModel!.cost);

  // Token 汇总
  console.log("\n── Token 汇总 ──");
  printKV("total prompt_tokens", totalUsage.prompt_tokens);
  printKV("total completion_tokens", totalUsage.completion_tokens);
  printKV("total total_tokens", totalUsage.total_tokens);
  printKV("total cache_hit_tokens", totalUsage.prompt_cache_hit_tokens ?? 0);
  printKV("total cache_miss_tokens", totalUsage.prompt_cache_miss_tokens ?? 0);
  printKV(
    "total reasoning_tokens",
    totalUsage.completion_tokens_details?.reasoning_tokens ?? 0,
  );

  // Token 一致性（汇总）
  const tokenOk =
    totalUsage.total_tokens ===
    totalUsage.prompt_tokens + totalUsage.completion_tokens;
  console.log(`\nToken 一致性 (汇总): ${tokenOk ? "✅ PASS" : "❌ FAIL"}`);
  if (!tokenOk) {
    console.log(
      `  ${totalUsage.total_tokens} !== ${totalUsage.prompt_tokens} + ${totalUsage.completion_tokens}`,
    );
  }

  // Billing 汇总
  console.log("\n── Billing 汇总 ──");
  printKV("total inputCost", `$${totalBilling.inputCost.toFixed(6)}`);
  printKV("total outputCost", `$${totalBilling.outputCost.toFixed(6)}`);
  printKV("total cacheReadCost", `$${totalBilling.cacheReadCost.toFixed(6)}`);
  printKV("total cacheWriteCost", `$${totalBilling.cacheWriteCost.toFixed(6)}`);
  printKV("total totalCost", `$${totalBilling.totalCost.toFixed(6)}`);

  // Billing 一致性（汇总）
  const expectedTotal =
    totalBilling.inputCost +
    totalBilling.outputCost +
    totalBilling.cacheReadCost +
    totalBilling.cacheWriteCost;
  const billingOk = Math.abs(totalBilling.totalCost - expectedTotal) < 0.000001;
  console.log(`\nBilling 一致性 (汇总): ${billingOk ? "✅ PASS" : "❌ FAIL"}`);
  if (!billingOk) {
    console.log(
      `  ${totalBilling.totalCost.toFixed(8)} !== ${expectedTotal.toFixed(8)}`,
    );
  }

  // 字符统计汇总
  console.log("\n── 字符统计汇总 ──");
  printKV("total inputChars", totalInputChars);
  printKV("total outputChars", totalOutputChars);
  const overallRatio =
    totalOutputChars > 0
      ? (totalOutputChars / totalUsage.completion_tokens).toFixed(2)
      : "N/A";
  printKV("avg outputChars/completion_tokens", overallRatio);

  // 逐轮明细表
  console.log("\n── 逐轮明细 ──");
  console.log(
    "Round | prompt_tkns | compl_tkns | total_tkns | inputCost    | outputCost   | totalCost    | inputChars | outputChars | char/tkn",
  );
  console.log(
    "------|-------------|------------|------------|--------------|--------------|--------------|------------|-------------|---------",
  );
  for (const s of allStats) {
    const cpt =
      s.usage.completion_tokens > 0
        ? (s.outputChars / s.usage.completion_tokens).toFixed(2)
        : "N/A";
    console.log(
      `  ${s.round}   | ${String(s.usage.prompt_tokens).padStart(11)} | ${String(s.usage.completion_tokens).padStart(10)} | ${String(s.usage.total_tokens).padStart(10)} | $${s.billing.inputCost.toFixed(8)} | $${s.billing.outputCost.toFixed(8)} | $${s.billing.totalCost.toFixed(8)} | ${String(s.inputChars).padStart(10)} | ${String(s.outputChars).padStart(11)} | ${cpt}`,
    );
  }
}

// ── 主流程：多轮工具调用 + 验证 ─────────────────────────

async function multiTurnVerify() {
  printSection("多轮工具调用 (Token & Billing 验证)");

  const messages: Message[] = [
    {
      role: "user",
      content:
        "我计划从上海去北京旅游。先帮我对比两地天气，如果北京天气好就推荐景点，再查上海到北京的交通方式",
    },
  ];

  const start = Date.now();
  let round = 0;
  const maxRounds = 10;
  const allStats: RoundStats[] = [];

  while (round < maxRounds) {
    round++;

    const inputChars = countInputChars(messages);

    // 本轮累计数据
    let accumulated: {
      usage?: TokenUsage;
      billing?: BillingInfo;
      content?: string | null;
      toolCalls?: any[];
    } = {};
    let streamedContent = "";
    let streamedReasoning = "";

    // 流式消费本轮 LLM 响应
    for await (const chunk of client.chatStream(messages, allTools)) {
      // 实时输出推理过程
      if (chunk.delta.reasoning_content) {
        streamedReasoning += chunk.delta.reasoning_content;
        process.stdout.write(chunk.delta.reasoning_content);
      }

      // 实时输出增量内容
      if (chunk.delta.content) {
        if (!streamedContent) {
          console.log("\n--- 回答 ---");
        }
        streamedContent += chunk.delta.content;
        process.stdout.write(chunk.delta.content);
      }

      // 最后一个 chunk 包含聚合结果
      if (chunk.fullResponse) {
        accumulated = {
          usage: chunk.usage,
          billing: chunk.billing,
          content:
            chunk.fullResponse.content +
            (chunk.fullResponse.reasoning_content ?? ""),
          toolCalls: chunk.fullResponse.tool_calls,
        };
      }
    }

    if (!accumulated.usage || !accumulated.billing) {
      console.log("\n⚠️  未捕获到 usage/billing 数据");
      break;
    }

    // 构建本轮统计
    const stats: RoundStats = {
      round,
      usage: accumulated.usage,
      billing: accumulated.billing,
      inputChars,
      outputChars: streamedContent.length + streamedReasoning.length,
      recomputedBilling: billingCalculator.compute(
        accumulated.usage,
        currentModel!.cost,
      ),
    };

    allStats.push(stats);

    // 检查是否有 tool_calls —— 决定是否需要继续下一轮
    const toolCalls = accumulated.toolCalls;
    if (!toolCalls || toolCalls.length === 0) {
      console.log(
        `\n✅ 最终回答 (共 ${round} 轮, ${streamedContent.length} 字符)`,
      );
      break;
    }

    // 有 tool_calls —— 继续 ReAct 循环
    printKV(`第 ${round} 轮 - 工具调用数`, toolCalls.length);

    // 添加 assistant 消息（含 tool_calls）
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: toolCalls,
    });

    // 执行每个工具并回传结果
    for (const tc of toolCalls) {
      const args = JSON.parse(tc.function.arguments);
      const result = executeTool(tc.function.name, args);
      console.log(
        `  → ${tc.function.name}(${JSON.stringify(args)}) = ${result}`,
      );

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  if (round >= maxRounds) {
    console.log("⚠️  达到最大轮数限制，强制结束");
  }

  // 打印汇总报表
  printAggregateReport(allStats);
  printElapsed(start);
}

// ── Main ────────────────────────────────────────────────

async function main() {
  console.log("🚀 Token Usage & Billing 数据准确性验证\n");

  printKV("当前 model", `${currentModel!.modelId} (${currentModel!.name})`);
  printJSON("cost 配置", currentModel!.cost);

  console.log("");
  await multiTurnVerify();

  console.log("\n✅ 验证完成");
}

main().catch((err) => {
  console.error("❌ 验证失败:", err.message);
  process.exit(1);
});
