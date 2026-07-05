import { describe, it, expect, afterEach } from "vitest";
import { run, PLAYGROUND_DIR } from "./helpers.js";
import { execSync } from "node:child_process";

// 清理测试目录
afterEach(() => {
  try {
    execSync("rm -rf _test_mkdir_single _test_mkdir_deep", {
      cwd: PLAYGROUND_DIR,
    });
  } catch {}
});

describe("mkdir - 创建目录", () => {
  it("should create a single directory", async () => {
    // 创建目录
    const { exitCode: mkdirExit } = await run(
      "mkdir _test_mkdir_single",
      "create-single",
    );
    expect(mkdirExit).toBe(0);

    // 验证目录存在
    const { exitCode: lsExit } = await run(
      "ls -ld _test_mkdir_single",
      "verify-single",
    );
    expect(lsExit).toBe(0);
  });

  it("should create nested directories with -p flag", async () => {
    // 递归创建嵌套目录
    const { exitCode } = await run(
      "mkdir -p _test_mkdir_deep/a/b/c",
      "create-nested",
    );
    expect(exitCode).toBe(0);

    // 验证目录结构
    const { output } = await run("ls -R _test_mkdir_deep", "verify-nested");
    expect(output).toContain("a");
    expect(output).toContain("b");
    expect(output).toContain("c");
  });

  it("should fail when creating existing directory without -p", async () => {
    // 创建目录
    await run("mkdir _test_mkdir_exists", "setup");

    // 尝试创建已存在的目录（mkdir 会报错，但 || 会捕获错误）
    const { output } = await run(
      "mkdir _test_mkdir_exists 2>&1 || echo '(already exists)'",
      "already-exists",
    );
    expect(output).toContain("already exists");

    // 清理
    try {
      execSync("rm -rf _test_mkdir_exists", { cwd: PLAYGROUND_DIR });
    } catch {}
  });

  it("should not error with -p on existing directory", async () => {
    // 创建目录
    await run("mkdir _test_mkdir_p_exists", "setup");

    // 使用 -p 对已存在目录不报错
    const { exitCode } = await run(
      "mkdir -p _test_mkdir_p_exists",
      "p-on-existing",
    );
    expect(exitCode).toBe(0);

    // 验证目录仍然存在
    const { exitCode: lsExit } = await run(
      "ls -ld _test_mkdir_p_exists",
      "verify-p-ok",
    );
    expect(lsExit).toBe(0);

    // 清理
    try {
      execSync("rm -rf _test_mkdir_p_exists", { cwd: PLAYGROUND_DIR });
    } catch {}
  });
});
