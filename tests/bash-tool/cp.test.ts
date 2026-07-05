import { describe, it, expect, afterEach } from "vitest";
import { run, PLAYGROUND_DIR } from "./helpers.js";
import { execSync } from "node:child_process";

// 清理测试文件
afterEach(() => {
  try {
    execSync("rm -f _test_cp_*.txt && rm -rf _test_cp_dir _test_cp_dir_copy", {
      cwd: PLAYGROUND_DIR,
    });
  } catch {}
});

describe("cp - 复制文件", () => {
  it("should copy a single file", async () => {
    // 创建源文件
    await run("echo 'copy me' > _test_cp_src.txt", "setup");

    // 复制文件
    const { exitCode: cpExit } = await run(
      "cp _test_cp_src.txt _test_cp_dst.txt",
      "copy-file",
    );
    expect(cpExit).toBe(0);

    // 验证文件内容相同
    const { output } = await run(
      "diff _test_cp_src.txt _test_cp_dst.txt && echo 'files match'",
      "verify-copy",
    );
    expect(output).toContain("files match");
  });

  it("should copy directory recursively", async () => {
    // 创建目录结构
    await run(
      "mkdir -p _test_cp_dir/sub && echo 'nested' > _test_cp_dir/sub/file.txt",
      "setup-dir",
    );

    // 递归复制
    const { exitCode } = await run(
      "cp -r _test_cp_dir _test_cp_dir_copy",
      "copy-recursive",
    );
    expect(exitCode).toBe(0);

    // 验证目录结构
    const { output } = await run("ls -R _test_cp_dir_copy", "verify-recursive");
    expect(output).toContain("sub");
    expect(output).toContain("file.txt");
  });

  it("should not overwrite with -n flag", async () => {
    // 创建源文件和目标文件
    await run(
      "echo 'original source' > _test_cp_noclobber_src.txt",
      "setup-src",
    );
    await run(
      "echo 'original target' > _test_cp_noclobber_dst.txt",
      "setup-dst",
    );

    // 尝试无覆盖复制
    const { exitCode, output } = await run(
      "cp -n _test_cp_noclobber_src.txt _test_cp_noclobber_dst.txt 2>&1 || echo '(no-clobber: refused)'",
      "no-clobber",
    );

    // 验证目标文件内容未被覆盖
    const { output: catOutput } = await run(
      "cat _test_cp_noclobber_dst.txt",
      "verify-not-overwritten",
    );
    expect(catOutput).toContain("original target");
  });
});
