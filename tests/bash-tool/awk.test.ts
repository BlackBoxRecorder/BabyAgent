import { describe, it, expect, afterEach } from "vitest";
import { run, PLAYGROUND_DIR } from "./helpers.js";
import { execSync } from "node:child_process";

// 清理测试文件
afterEach(() => {
  try {
    execSync("rm -f _test_awk_*.csv", { cwd: PLAYGROUND_DIR });
  } catch {}
});

describe("awk - 文本处理", () => {
  it("should extract fields", async () => {
    // 准备 CSV 测试数据
    await run(
      "printf 'Alice,30,Engineer\\nBob,25,Designer\\nCharlie,35,Manager\\n' > _test_awk_data.csv",
      "setup",
    );

    // 字段提取（第 1 和第 3 列）
    const { output } = await run(
      "awk -F',' '{print $1, $3}' _test_awk_data.csv",
      "field-extract",
    );
    expect(output).toContain("Alice Engineer");
    expect(output).toContain("Bob Designer");
    expect(output).toContain("Charlie Manager");
  });

  it("should filter by condition", async () => {
    // 准备 CSV 测试数据
    await run(
      "printf 'Alice,30,Engineer\\nBob,25,Designer\\nCharlie,35,Manager\\n' > _test_awk_filter.csv",
      "setup",
    );

    // 条件过滤（年龄 > 28）
    const { output } = await run(
      "awk -F',' '$2 > 28' _test_awk_filter.csv",
      "conditional-filter",
    );
    expect(output).toContain("Alice,30,Engineer");
    expect(output).toContain("Charlie,35,Manager");
    expect(output).not.toContain("Bob,25,Designer");
  });

  it("should use built-in variables NR and NF", async () => {
    // 准备 CSV 测试数据
    await run(
      "printf 'Alice,30,Engineer\\nBob,25,Designer\\n' > _test_awk_vars.csv",
      "setup",
    );

    // 使用 NR（行号）和 NF（字段数）
    const { output } = await run(
      'awk -F\',\' \'{print NR ": " $1 " (" NF " fields)"}\' _test_awk_vars.csv',
      "builtin-vars",
    );
    expect(output).toContain("1: Alice (3 fields)");
    expect(output).toContain("2: Bob (3 fields)");
  });

  it("should calculate sum", async () => {
    // 准备 CSV 测试数据
    await run(
      "printf 'Alice,30,Engineer\\nBob,25,Designer\\nCharlie,35,Manager\\n' > _test_awk_sum.csv",
      "setup",
    );

    // 求和（年龄总和）
    const { output } = await run(
      "awk -F',' '{sum += $2} END {print \"Total age:\", sum}' _test_awk_sum.csv",
      "sum",
    );
    expect(output).toContain("Total age: 90");
  });

  it("should format output", async () => {
    // 准备 CSV 测试数据
    await run(
      "printf 'Alice,30,Engineer\\nBob,25,Designer\\n' > _test_awk_format.csv",
      "setup",
    );

    // 格式化输出
    const { output } = await run(
      "awk -F',' 'BEGIN {print \"Name\\tAge\\tRole\"} {printf \"%-10s %-5s %s\\n\", $1, $2, $3}' _test_awk_format.csv",
      "formatted",
    );
    expect(output).toContain("Name");
    expect(output).toContain("Age");
    expect(output).toContain("Role");
    expect(output).toContain("Alice");
    expect(output).toContain("30");
    expect(output).toContain("Engineer");
  });
});
