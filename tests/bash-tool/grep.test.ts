import { describe, it, expect, afterEach } from "vitest";
import { run, PLAYGROUND_DIR } from "./helpers.js";
import { execSync } from "node:child_process";

// 清理测试文件
afterEach(() => {
  try {
    execSync("rm -rf _test_grep_dir", { cwd: PLAYGROUND_DIR });
  } catch {}
});

describe("grep - 模式搜索", () => {
  it("should search for basic pattern", async () => {
    // 准备测试目录和文件
    await run("mkdir -p _test_grep_dir", "setup-dir");
    await run(
      "printf 'hello world\\nfoo bar\\nhello again\\ntest line\\n' > _test_grep_dir/file1.txt",
      "create-file1",
    );

    // 基本模式搜索
    const { output } = await run(
      "grep 'hello' _test_grep_dir/file1.txt",
      "basic-search",
    );
    expect(output).toContain("hello world");
    expect(output).toContain("hello again");
    expect(output).not.toContain("foo bar");
  });

  it("should search recursively in directory", async () => {
    // 准备测试目录和文件
    await run("mkdir -p _test_grep_dir", "setup-dir");
    await run(
      "printf 'hello world\\nfoo bar\\n' > _test_grep_dir/file1.txt",
      "create-file1",
    );
    await run(
      "printf 'another file\\nwith hello\\nand goodbye\\n' > _test_grep_dir/file2.txt",
      "create-file2",
    );

    // 递归搜索目录
    const { output } = await run(
      "grep -r 'hello' _test_grep_dir",
      "recursive-search",
    );
    expect(output).toContain("file1.txt");
    expect(output).toContain("file2.txt");
  });

  it("should count matches", async () => {
    // 准备测试文件
    await run("mkdir -p _test_grep_dir", "setup-dir");
    await run(
      "printf 'hello world\\nfoo bar\\nhello again\\ntest line\\n' > _test_grep_dir/file1.txt",
      "create-file1",
    );

    // 计数模式
    const { output } = await run(
      "grep -c 'hello' _test_grep_dir/file1.txt",
      "count-matches",
    );
    expect(output.trim()).toBe("2");
  });

  it("should show line numbers", async () => {
    // 准备测试文件
    await run("mkdir -p _test_grep_dir", "setup-dir");
    await run(
      "printf 'hello world\\nfoo bar\\nhello again\\ntest line\\n' > _test_grep_dir/file1.txt",
      "create-file1",
    );

    // 显示行号
    const { output } = await run(
      "grep -n 'hello' _test_grep_dir/file1.txt",
      "with-line-numbers",
    );
    expect(output).toContain("1:hello world");
    expect(output).toContain("3:hello again");
  });

  it("should invert match", async () => {
    // 准备测试文件
    await run("mkdir -p _test_grep_dir", "setup-dir");
    await run(
      "printf 'hello world\\nfoo bar\\nhello again\\ntest line\\n' > _test_grep_dir/file1.txt",
      "create-file1",
    );

    // 反向匹配（不包含 hello 的行）
    const { output } = await run(
      "grep -v 'hello' _test_grep_dir/file1.txt",
      "invert-match",
    );
    expect(output).toContain("foo bar");
    expect(output).toContain("test line");
    expect(output).not.toContain("hello");
  });

  it("should be case insensitive", async () => {
    // 准备测试文件
    await run("mkdir -p _test_grep_dir", "setup-dir");
    await run(
      "printf 'hello world\\nfoo bar\\nHELLO again\\ntest line\\n' > _test_grep_dir/file1.txt",
      "create-file1",
    );

    // 忽略大小写
    const { output } = await run(
      "grep -i 'HELLO' _test_grep_dir/file1.txt",
      "case-insensitive",
    );
    expect(output).toContain("hello world");
    expect(output).toContain("HELLO again");
  });
});
