import { describe, it, expect, afterEach } from "vitest";
import { run, PLAYGROUND_DIR } from "./helpers.js";
import { execSync } from "node:child_process";

// 清理测试文件
afterEach(() => {
  try {
    execSync("rm -f _test_mv_*.txt", { cwd: PLAYGROUND_DIR });
  } catch {}
});

describe("mv - 移动/重命名文件", () => {
  it("should move a file", async () => {
    // 创建源文件
    await run("echo 'move me' > _test_mv_src.txt", "setup");

    // 移动文件
    const { exitCode: mvExit } = await run(
      "mv _test_mv_src.txt _test_mv_dst.txt",
      "move-file",
    );
    expect(mvExit).toBe(0);

    // 验证目标文件内容
    const { output: content } = await run(
      "cat _test_mv_dst.txt",
      "verify-moved",
    );
    expect(content).toContain("move me");

    // 验证源文件不存在
    const { output: lsOutput } = await run(
      "ls _test_mv_src.txt 2>&1 || echo '(source gone)'",
      "verify-source-gone",
    );
    expect(lsOutput).toContain("(source gone)");
  });

  it("should rename a file", async () => {
    // 创建文件
    await run("echo 'rename me' > _test_mv_rename_src.txt", "setup");

    // 重命名
    const { exitCode } = await run(
      "mv _test_mv_rename_src.txt _test_mv_renamed.txt",
      "rename",
    );
    expect(exitCode).toBe(0);

    // 验证重命名后内容
    const { output } = await run("cat _test_mv_renamed.txt", "verify-renamed");
    expect(output).toContain("rename me");
  });

  it("should overwrite target file with -f flag", async () => {
    // 创建源文件和目标文件
    await run("echo 'source content' > _test_mv_over_src.txt", "setup-src");
    await run("echo 'target content' > _test_mv_over_dst.txt", "setup-dst");

    // 强制覆盖
    const { exitCode } = await run(
      "mv -f _test_mv_over_src.txt _test_mv_over_dst.txt",
      "overwrite-move",
    );
    expect(exitCode).toBe(0);

    // 验证覆盖后内容
    const { output } = await run(
      "cat _test_mv_over_dst.txt",
      "verify-overwritten",
    );
    expect(output).toContain("source content");
    expect(output).not.toContain("target content");
  });
});
