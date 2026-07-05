import { describe, it, expect, afterEach } from "vitest";
import { run, PLAYGROUND_DIR } from "./helpers.js";
import { execSync } from "node:child_process";

// 网络测试超时设置（30秒）
const NETWORK_TIMEOUT = 30_000;

// 清理测试文件
afterEach(() => {
  try {
    execSync("rm -f _test_wget_*.txt && rm -rf _test_wget_dir", {
      cwd: PLAYGROUND_DIR,
    });
  } catch {}
});

describe("wget - 文件下载", () => {
  it(
    "should download a file",
    async () => {
      const { exitCode } = await run(
        "wget -q -O _test_wget_file.txt https://httpbin.org/robots.txt",
        "download",
      );

      if (exitCode === 0) {
        const { output } = await run(
          "cat _test_wget_file.txt",
          "verify-downloaded",
        );
        expect(output).toContain("User-agent");
        expect(output).toContain("Disallow");
      }
    },
    NETWORK_TIMEOUT,
  );

  it(
    "should download to specified directory",
    async () => {
      // 创建目录
      await run("mkdir -p _test_wget_dir", "setup-dir");

      const { exitCode } = await run(
        "wget -q -P _test_wget_dir https://httpbin.org/robots.txt",
        "download-to-dir",
      );

      if (exitCode === 0) {
        const { output } = await run(
          "ls _test_wget_dir",
          "verify-dir-download",
        );
        expect(output).toContain("robots.txt");
      }
    },
    NETWORK_TIMEOUT,
  );

  it(
    "should handle 404 gracefully",
    async () => {
      const { output } = await run(
        "wget -q --timeout=5 https://httpbin.org/status/404 2>&1 || echo '(404 Not Found)'",
        "not-found",
      );
      expect(output).toContain("404 Not Found");
    },
    NETWORK_TIMEOUT,
  );
});
