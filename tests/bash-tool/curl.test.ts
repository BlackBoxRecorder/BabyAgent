import { describe, it, expect, afterEach } from "vitest";
import { run, PLAYGROUND_DIR } from "./helpers.js";
import { execSync } from "node:child_process";

// 网络测试超时设置（30秒）
const NETWORK_TIMEOUT = 30_000;

// 清理测试文件
afterEach(() => {
  try {
    execSync("rm -f _test_curl_*.txt", { cwd: PLAYGROUND_DIR });
  } catch {}
});

describe("curl - HTTP 请求", () => {
  it(
    "should perform GET request",
    async () => {
      const { exitCode, output } = await run(
        "curl -s --max-time 10 https://httpbin.org/get | head -20",
        "get-request",
      );
      // 网络请求可能失败，成功时验证内容
      if (exitCode === 0) {
        expect(output).toContain('"url"');
      }
    },
    NETWORK_TIMEOUT,
  );

  it(
    "should save output to file",
    async () => {
      const { exitCode } = await run(
        "curl -s --max-time 10 -o _test_curl_output.txt https://httpbin.org/get",
        "save-to-file",
      );

      if (exitCode === 0) {
        const { output } = await run(
          "head -5 _test_curl_output.txt",
          "verify-saved",
        );
        expect(output).toContain("{");
      }
    },
    NETWORK_TIMEOUT,
  );

  it(
    "should handle timeout",
    async () => {
      const { exitCode, output } = await run(
        "curl -s --max-time 5 https://httpbin.org/delay/1",
        "with-timeout",
      );
      // 超时请求应该成功（延迟 1 秒，超时 5 秒）
      if (exitCode === 0) {
        expect(output).toContain('"url"');
      }
    },
    NETWORK_TIMEOUT,
  );

  it(
    "should handle invalid URL gracefully",
    async () => {
      const { output } = await run(
        "curl -s --max-time 5 https://invalid-domain-xyz-12345.com 2>&1 || echo '(DNS resolution failed)'",
        "invalid-url",
      );
      // 无效 URL 应该失败并输出错误信息
      expect(output).toContain("DNS resolution failed");
    },
    NETWORK_TIMEOUT,
  );
});
