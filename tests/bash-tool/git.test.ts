import { describe, it, expect, afterEach } from "vitest";
import { run, PLAYGROUND_DIR } from "./helpers.js";
import { execSync } from "node:child_process";

// 清理测试目录
afterEach(() => {
  try {
    execSync("rm -rf _test_git_repo", { cwd: PLAYGROUND_DIR });
  } catch {}
});

describe("git - 版本控制", () => {
  it("should initialize a git repository", async () => {
    // 创建并初始化 git 仓库
    const { exitCode } = await run(
      "mkdir _test_git_repo && cd _test_git_repo && git init",
      "init",
    );
    expect(exitCode).toBe(0);

    // 验证仓库状态
    const { output } = await run(
      "cd _test_git_repo && git status",
      "status-after-init",
    );
    expect(output).toContain("On branch");
  });

  it("should add and commit files", async () => {
    // 创建仓库
    await run("mkdir _test_git_repo && cd _test_git_repo && git init", "init");

    // 创建文件并添加到暂存区
    await run(
      "echo '# Test Project' > _test_git_repo/README.md",
      "create-file",
    );
    const { exitCode: addExit } = await run(
      "cd _test_git_repo && git add README.md",
      "add",
    );
    expect(addExit).toBe(0);

    // 提交
    const { exitCode: commitExit } = await run(
      'cd _test_git_repo && git -c user.name="test" -c user.email="test@test.com" commit -m "initial commit"',
      "commit",
    );
    expect(commitExit).toBe(0);

    // 验证提交历史
    const { output: logOutput } = await run(
      "cd _test_git_repo && git log --oneline",
      "log",
    );
    expect(logOutput).toContain("initial commit");
  });

  it("should create and switch branches", async () => {
    // 创建仓库并提交
    await run("mkdir _test_git_repo && cd _test_git_repo && git init", "init");
    await run("echo '# Test' > _test_git_repo/README.md", "create-file");
    await run(
      'cd _test_git_repo && git add README.md && git -c user.name="test" -c user.email="test@test.com" commit -m "initial"',
      "commit",
    );

    // 创建分支
    const { exitCode: branchExit } = await run(
      "cd _test_git_repo && git checkout -b feature-branch",
      "create-branch",
    );
    expect(branchExit).toBe(0);

    // 验证分支列表
    const { output: branchOutput } = await run(
      "cd _test_git_repo && git branch",
      "list-branches",
    );
    expect(branchOutput).toContain("feature-branch");
    expect(branchOutput).toContain("main");

    // 切换分支
    const { exitCode: switchExit } = await run(
      "cd _test_git_repo && git checkout main || git checkout master",
      "switch-branch",
    );
    expect(switchExit).toBe(0);
  });

  it("should handle unstaged changes", async () => {
    // 创建仓库并提交
    await run("mkdir _test_git_repo && cd _test_git_repo && git init", "init");
    await run("echo '# Test' > _test_git_repo/README.md", "create-file");
    await run(
      'cd _test_git_repo && git add README.md && git -c user.name="test" -c user.email="test@test.com" commit -m "initial"',
      "commit",
    );

    // 修改文件但不暂存
    await run(
      "echo 'unstaged change' >> _test_git_repo/README.md",
      "modify-no-stage",
    );

    // 尝试提交（应该失败或提示无更改）
    const { output } = await run(
      'cd _test_git_repo && git -c user.name="test" -c user.email="test@test.com" commit -m "will fail" 2>&1 || echo "(nothing to commit)"',
      "commit-no-stage",
    );
    expect(output).toContain("nothing to commit");
  });
});
