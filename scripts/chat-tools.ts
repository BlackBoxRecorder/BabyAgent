/// <reference types="node" />

/**
 * 验证脚本：工具调用
 *
 * 测试：工具定义 → tool_calls 生成 → tool_result 回传 → 最终回答
 *
 * 用法：npx tsx scripts/chat-tools.ts
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

// ── 工具定义 ────────────────────────────────────────────

const weatherTool = {
  type: "function" as const,
  function: {
    name: "get_weather",
    description: "获取指定城市的当前天气",
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "城市名称，例如：北京、上海",
        },
      },
      required: ["city"],
    },
  },
};

// ── 模拟工具执行 ────────────────────────────────────────

function executeGetWeather(args: { city: string }): string {
  const weathers: Record<string, string> = {
    北京: "晴天，25°C，湿度 40%",
    上海: "多云，22°C，湿度 65%",
    广州: "阵雨，28°C，湿度 80%",
    深圳: "晴转多云，27°C，湿度 55%",
  };
  return weathers[args.city] ?? `未知城市 "${args.city}"，请检查城市名称。`;
}

const attractionsTool = {
  type: "function" as const,
  function: {
    name: "get_attractions",
    description: "获取指定城市的旅游景点列表",
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "城市名称，例如：北京、上海",
        },
      },
      required: ["city"],
    },
  },
};

const transportTool = {
  type: "function" as const,
  function: {
    name: "get_transport",
    description: "获取两个城市之间的交通方式、耗时和价格信息",
    parameters: {
      type: "object",
      properties: {
        from_city: {
          type: "string",
          description: "出发城市名称",
        },
        to_city: {
          type: "string",
          description: "目的地城市名称",
        },
      },
      required: ["from_city", "to_city"],
    },
  },
};

// ── 模拟工具执行 ────────────────────────────────────────

function executeGetAttractions(args: { city: string }): string {
  const attractions: Record<string, string> = {
    北京: "故宫、长城、天坛、颐和园、798艺术区",
    上海: "外滩、东方明珠、南京路步行街、豫园、迪士尼乐园",
    广州: "广州塔、白云山、陈家祠、沙面岛、长隆欢乐世界",
    深圳: "世界之窗、欢乐谷、大小梅沙、深圳湾公园、莲花山",
  };
  return attractions[args.city] ?? `未知城市 "${args.city}"，请检查城市名称。`;
}

function executeGetTransport(args: {
  from_city: string;
  to_city: string;
}): string {
  const key = `${args.from_city}->${args.to_city}`;
  const transports: Record<string, string> = {
    "上海->北京": "高铁：约4.5小时，二等座553元；飞机：约2小时，经济舱约800元",
    "北京->上海": "高铁：约4.5小时，二等座553元；飞机：约2小时，经济舱约800元",
    "广州->深圳": "高铁：约30分钟，二等座74元；城际列车：约1小时",
    "深圳->广州": "高铁：约30分钟，二等座74元；城际列车：约1小时",
  };
  return (
    transports[key] ??
    `暂无${args.from_city}到${args.to_city}的直达交通信息，建议中转或选择其他方式。`
  );
}

// ── 1. 单工具调用 ──────────────────────────────────────

async function singleToolCall() {
  printSection("1. 单工具调用 (查天气)");

  const messages: Message[] = [
    { role: "user", content: "北京今天天气怎么样？" },
  ];

  const start = Date.now();

  // Step 1: 发送请求，期望 LLM 返回 tool_calls
  let res1: LLMResponse | undefined;
  for await (const chunk of client.chatStream(messages, [weatherTool])) {
    if (chunk.accumulated) {
      res1 = chunk.accumulated;
    }
  }
  printKV("Step 1 - finish_reason", res1!.finish_reason);
  printJSON("Step 1 - tool_calls", res1!.tool_calls);

  if (!res1!.tool_calls || res1!.tool_calls.length === 0) {
    console.log("⚠️  模型未返回工具调用");
    return;
  }

  // 添加 assistant 消息（含 tool_calls）
  messages.push({
    role: "assistant",
    content: null,
    tool_calls: res1!.tool_calls,
  });

  // Step 2: 执行工具并回传结果
  for (const tc of res1!.tool_calls!) {
    const args = JSON.parse(tc.function.arguments);
    const result = executeGetWeather(args);
    printKV(`Step 2 - 执行 ${tc.function.name}(${args.city})`, result);

    messages.push({
      role: "tool",
      tool_call_id: tc.id,
      content: result,
    });
  }

  // Step 3: 获取最终回答
  let res2: LLMResponse | undefined;
  for await (const chunk of client.chatStream(messages, [weatherTool])) {
    if (chunk.accumulated) {
      res2 = chunk.accumulated;
    }
  }
  printKV("Step 3 - finish_reason", res2!.finish_reason);
  printKV("Step 3 - content", res2!.content);

  printElapsed(start);
}

// ── 2. 无需工具的问题 ───────────────────────────────────

async function noToolNeeded() {
  printSection("2. 无需工具的问题");

  const messages: Message[] = [{ role: "user", content: "1+1等于几？" }];

  const start = Date.now();
  let res: LLMResponse | undefined;
  for await (const chunk of client.chatStream(messages, [weatherTool])) {
    if (chunk.accumulated) {
      res = chunk.accumulated;
    }
  }
  printElapsed(start);

  printKV("finish_reason", res!.finish_reason);
  printKV("content", res!.content);
  printKV("tool_calls", res!.tool_calls ? "存在" : "无 (正确)");
}

// ── 3. 多轮工具调用 ───────────────────────────────────

async function multiTurnToolCall() {
  printSection("3. 多轮工具调用 (流式 + ReAct 循环)");

  const allTools = [weatherTool, attractionsTool, transportTool];

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

  while (round < maxRounds) {
    round++;
    printKV(`\n第 ${round} 轮 - start`, round);

    // 流式消费本轮响应
    let streamedContent = "";
    let streamedReasoning = "";
    let accumulated: LLMResponse | undefined;

    for await (const chunk of client.chatStream(messages, allTools)) {
      // 实时输出推理过程
      if (chunk.delta.reasoning_content) {
        streamedReasoning += chunk.delta.reasoning_content;
        process.stdout.write(chunk.delta.reasoning_content);
      }

      // 实时输出增量内容（最终回答时有效，推理结束后开始）
      if (chunk.delta.content) {
        // 首次输出内容时换行分隔推理和回答
        if (!streamedContent) {
          console.log("\n--- 回答 ---");
        }
        streamedContent += chunk.delta.content;
        process.stdout.write(chunk.delta.content);
      }

      // 最后一个 chunk 包含聚合结果
      if (chunk.accumulated) {
        accumulated = chunk.accumulated;
      }
    }

    if (!accumulated) {
      console.log("⚠️  未收到聚合结果");
      break;
    }

    printKV(`\n第 ${round} 轮 - finish_reason`, accumulated.finish_reason);
    if (streamedReasoning) {
      printKV(`  推理内容长度`, `${streamedReasoning.length} 字符`);
    }

    if (accumulated.tool_calls && accumulated.tool_calls.length > 0) {
      console.log(`  工具调用 (${accumulated.tool_calls.length}个):`);
      for (const tc of accumulated.tool_calls) {
        console.log(`    → ${tc.function.name}(${tc.function.arguments})`);
      }

      // 添加 assistant 消息（含 tool_calls）
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: accumulated.tool_calls,
      });

      // 执行每个工具并回传结果
      for (const tc of accumulated.tool_calls) {
        const args = JSON.parse(tc.function.arguments);
        let result: string;

        switch (tc.function.name) {
          case "get_weather":
            result = executeGetWeather(args);
            break;
          case "get_attractions":
            result = executeGetAttractions(args);
            break;
          case "get_transport":
            result = executeGetTransport(args);
            break;
          default:
            result = `未知工具: ${tc.function.name}`;
        }

        printKV(`  执行 ${tc.function.name}`, result);

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }
    } else {
      // 最终回答（内容已通过流式输出）
      console.log("");
      printKV(
        `最终回答 (${round}轮，${streamedContent.length}字符)`,
        "见上方流式输出",
      );
      break;
    }

    printKV(`\n第 ${round} 轮 - end`, round);
  }

  if (round >= maxRounds) {
    console.log("⚠️  达到最大轮数限制，强制结束");
  }

  printElapsed(start);
}

// ── Main ────────────────────────────────────────────────

async function main() {
  console.log("🚀 LLM 工具调用验证\n");

  await singleToolCall();
  await noToolNeeded();
  await multiTurnToolCall();

  console.log("\n✅ 工具调用验证完成");
}

main().catch((err) => {
  console.error("❌ 验证失败:", err.message);
  process.exit(1);
});
