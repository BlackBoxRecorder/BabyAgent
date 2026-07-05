import { describe, it, expect, beforeEach } from "vitest";
import {
  clearPlayground,
  createTestFile,
  createTestDir,
  getTool,
} from "./setup.js";

describe("find工具", () => {
  let tool: ReturnType<typeof getTool>;

  beforeEach(() => {
    clearPlayground();
    tool = getTool("find");
  });

  function textOf(result: { content: Array<{ type: string }> }): string {
    return (result.content[0] as { type: "text"; text: string }).text;
  }

  describe("基本功能", () => {
    it("应该按扩展名查找文件", async () => {
      createTestFile("file1.txt", "content1");
      createTestFile("file2.txt", "content2");
      createTestFile("file3.js", "content3");

      const result = await tool.execute({ pattern: "*.txt" });
      const output = textOf(result);

      expect(output).toContain("file1.txt");
      expect(output).toContain("file2.txt");
      expect(output).not.toContain("file3.js");
    });

    it("应该查找所有文件", async () => {
      createTestFile("aaa_file1.txt", "content1");
      createTestFile("aaa_file2.js", "content2");

      const result = await tool.execute({ pattern: "aaa_*" });
      const output = textOf(result);

      expect(output).toContain("aaa_file1.txt");
      expect(output).toContain("aaa_file2.js");
    });
  });

  describe("递归查找", () => {
    it("应该递归查找子目录", async () => {
      createTestFile("file1.txt", "content1");
      createTestFile("sub/file2.txt", "content2");
      createTestFile("sub/deep/file3.txt", "content3");

      const result = await tool.execute({ pattern: "*.txt" });
      const output = textOf(result);

      expect(output).toContain("file1.txt");
      expect(output).toContain("file2.txt");
      expect(output).toContain("file3.txt");
    });
  });

  describe("限制结果", () => {
    it("应该限制结果数量", async () => {
      for (let i = 0; i < 20; i++) {
        createTestFile(`zzz_${String(i).padStart(2, "0")}.txt`, `content ${i}`);
      }

      const result = await tool.execute({ pattern: "zzz_*.txt", limit: 5 });

      const lines = textOf(result)
        .split("\n")
        .filter((l: string) => l.trim());
      expect(lines.length).toBeLessThanOrEqual(6); // fd max-results 可能返回略多于限制的结果
    });
  });

  describe("隐藏文件", () => {
    it("应该查找隐藏文件", async () => {
      createTestFile(".hidden", "hidden content");
      createTestFile("visible.txt", "visible content");

      const result = await tool.execute({ pattern: "*" });
      const output = textOf(result);

      expect(output).toContain(".hidden");
      expect(output).toContain("visible.txt");
    });
  });

  describe("glob模式", () => {
    it("应该支持通配符模式", async () => {
      createTestFile("aaa_file1.txt", "content1");
      createTestFile("aaa_file2.log", "content2");

      const result = await tool.execute({ pattern: "aaa_file*.txt" });
      const output = textOf(result);

      expect(output).toContain("aaa_file1.txt");
      expect(output).not.toContain("aaa_file2.log");
    });

    it("应该支持多个扩展名", async () => {
      createTestFile("bbb_file1.txt", "content1");
      createTestFile("bbb_file2.js", "content2");
      createTestFile("bbb_file3.ts", "content3");

      const result = await tool.execute({ pattern: "bbb_*.{js,ts}" });
      const output = textOf(result);

      expect(output).not.toContain("bbb_file1.txt");
      expect(output).toContain("bbb_file2.js");
      expect(output).toContain("bbb_file3.ts");
    });
  });

  describe("无匹配结果", () => {
    it("应该返回无匹配提示", async () => {
      createTestFile("file.txt", "content");

      const result = await tool.execute({ pattern: "*.nonexistent" });

      expect(textOf(result)).toContain("(no files found)");
    });
  });

  describe("返回值", () => {
    it("应该在限制时返回resultLimitReached", async () => {
      for (let i = 0; i < 20; i++) {
        createTestFile(
          `limit_${String(i).padStart(2, "0")}.txt`,
          `content ${i}`,
        );
      }

      const result = await tool.execute({ pattern: "limit_*.txt", limit: 5 });

      expect(result.details).toBeDefined();
      expect((result.details as any).resultLimitReached).toBe(5);
    });
  });
});
