import { describe, it, expect, afterEach } from "vitest";
import { run, PLAYGROUND_DIR } from "./helpers.js";
import { execSync } from "node:child_process";

// 清理测试文件
afterEach(() => {
  try {
    execSync("rm -f _test_sed_*.txt", { cwd: PLAYGROUND_DIR });
  } catch {}
});

describe("sed - 流编辑器", () => {
  it("should substitute text", async () => {
    // 准备测试文件
    await run(
      "echo 'hello world\\nfoo bar\\nhello again' > _test_sed_input.txt",
      "setup",
    );

    // 文本替换
    const { output } = await run(
      "sed 's/hello/hi/g' _test_sed_input.txt",
      "substitute",
    );
    expect(output).toContain("hi world");
    expect(output).toContain("hi again");
    expect(output).not.toContain("hello");
  });

  it("should match regex patterns", async () => {
    // 准备测试文件
    await run(
      "printf 'hello world\\nfoo bar\\nhello again\\n' > _test_sed_regex.txt",
      "setup",
    );

    // 正则匹配（使用基本正则语法）
    const { output } = await run(
      "sed 's/[a-z]*/**/g' _test_sed_regex.txt",
      "regex-match",
    );
    expect(output).toContain("**");
  });

  it("should delete lines matching pattern", async () => {
    // 准备测试文件
    await run(
      "printf 'hello world\\nfoo bar\\nhello again\\n' > _test_sed_delete.txt",
      "setup",
    );

    // 删除包含 foo 的行
    const { output } = await run(
      "sed '/foo/d' _test_sed_delete.txt",
      "delete-line",
    );
    expect(output).toContain("hello world");
    expect(output).toContain("hello again");
    expect(output).not.toContain("foo bar");
  });

  it("should edit file in-place with -i flag", async () => {
    // 准备测试文件
    await run(
      "echo 'hello world\\nfoo bar\\nhello again' > _test_sed_inplace_input.txt",
      "setup-input",
    );
    await run(
      "cp _test_sed_inplace_input.txt _test_sed_inplace.txt",
      "setup-inplace",
    );

    // 原地编辑
    const { exitCode } = await run(
      "sed -i '' 's/world/universe/' _test_sed_inplace.txt",
      "inplace-edit",
    );
    expect(exitCode).toBe(0);

    // 验证文件内容已修改
    const { output } = await run("cat _test_sed_inplace.txt", "verify-inplace");
    expect(output).toContain("hello universe");
    expect(output).not.toContain("hello world");
  });

  it("should print specific line by number", async () => {
    // 准备测试文件
    await run(
      "printf 'line1\\nline2\\nline3\\n' > _test_sed_lines.txt",
      "setup",
    );

    // 打印第 2 行
    const { output } = await run(
      "sed -n '2p' _test_sed_lines.txt",
      "print-line-2",
    );
    expect(output.trim()).toBe("line2");
  });
});
