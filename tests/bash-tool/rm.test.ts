import { describe, it, expect, afterEach } from "vitest";
import { run, PLAYGROUND_DIR } from "./helpers.js";
import { execSync } from "node:child_process";

// 清理测试文件
afterEach(() => {
  try {
    execSync("rm -f _test_rm*.txt && rm -rf _test_rm_dir", {
      cwd: PLAYGROUND_DIR,
    });
  } catch {}
});

describe("rm - 删除文件", () => {
  it("should delete a single file", async () => {
    // 创建文件
    await run("echo 'temporary test file' > _test_rm.txt", "setup");

    // 验证文件存在
    const { exitCode: lsExit } = await run("ls _test_rm.txt", "verify-created");
    expect(lsExit).toBe(0);

    // 删除文件
    const { exitCode: rmExit } = await run("rm _test_rm.txt", "rm-file");
    expect(rmExit).toBe(0);

    // 验证文件已删除
    const { output } = await run(
      "ls _test_rm.txt 2>&1 || echo '(file removed)'",
      "verify-removed",
    );
    expect(output).toContain("(file removed)");
  });

  it("should delete directory recursively", async () => {
    // 创建目录
    await run(
      "mkdir -p _test_rm_dir/sub && touch _test_rm_dir/sub/file.txt",
      "setup-dir",
    );

    // 验证目录存在
    const { exitCode: lsExit } = await run("ls -R _test_rm_dir", "verify-dir");
    expect(lsExit).toBe(0);

    // 递归删除
    const { exitCode: rmExit } = await run(
      "rm -rf _test_rm_dir",
      "rm-recursive",
    );
    expect(rmExit).toBe(0);

    // 验证目录已删除
    const { output } = await run(
      "ls _test_rm_dir 2>&1 || echo '(directory removed)'",
      "verify-dir-removed",
    );
    expect(output).toContain("(directory removed)");
  });

  it("should fail when deleting nonexistent file", async () => {
    const { exitCode } = await run(
      "rm nonexistent_file_xyz_12345",
      "rm-nonexistent",
    );
    expect(exitCode).not.toBe(0);
  });
});
