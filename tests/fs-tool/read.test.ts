import { describe, it, expect, beforeEach } from "vitest";
import { clearPlayground, createTestFile, getTool } from "./setup.js";

describe("read工具", () => {
  let tool: ReturnType<typeof getTool>;

  beforeEach(() => {
    clearPlayground();
    tool = getTool("read");
  });

  function textOf(result: { content: Array<{ type: string }> }): string {
    return (result.content[0] as { type: "text"; text: string }).text;
  }

  describe("基本功能", () => {
    it("应该读取文本文件内容", async () => {
      createTestFile("test.txt", "Hello, World!");

      const result = await tool.execute({ path: "test.txt" });

      expect(textOf(result)).toBe("Hello, World!");
    });

    it("应该读取空文件", async () => {
      createTestFile("empty.txt", "");

      const result = await tool.execute({ path: "empty.txt" });

      expect(textOf(result)).toBe("");
    });

    it("应该读取多行文件", async () => {
      const content = "Line 1\nLine 2\nLine 3";
      createTestFile("multiline.txt", content);

      const result = await tool.execute({ path: "multiline.txt" });

      expect(textOf(result)).toBe(content);
    });
  });

  describe("偏移量和限制", () => {
    it("应该支持offset参数", async () => {
      createTestFile("lines.txt", "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");

      const result = await tool.execute({ path: "lines.txt", offset: 3 });

      expect(textOf(result)).toContain("Line 3");
      expect(textOf(result)).toContain("Line 5");
    });

    it("应该支持limit参数", async () => {
      createTestFile("limit.txt", "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");

      const result = await tool.execute({ path: "limit.txt", limit: 2 });

      expect(textOf(result)).toContain("Line 1");
      expect(textOf(result)).toContain("Line 2");
      expect(textOf(result)).not.toContain("Line 3");
    });

    it("应该支持offset和limit组合", async () => {
      createTestFile("combo.txt", "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");

      const result = await tool.execute({
        path: "combo.txt",
        offset: 2,
        limit: 2,
      });

      expect(textOf(result)).toContain("Line 2");
      expect(textOf(result)).toContain("Line 3");
      expect(textOf(result)).not.toContain("Line 1");
      expect(textOf(result)).not.toContain("Line 4");
    });

    it("应该处理offset超出文件长度", async () => {
      createTestFile("short.txt", "Line 1\nLine 2");

      await expect(
        tool.execute({ path: "short.txt", offset: 10 }),
      ).rejects.toThrow();
    });
  });

  describe("大文件截断", () => {
    it("应该截断大文件并提供续读提示", async () => {
      const lines = Array.from({ length: 3000 }, (_, i) => `Line ${i + 1}`);
      createTestFile("large.txt", lines.join("\n"));

      const result = await tool.execute({ path: "large.txt" });

      expect(textOf(result)).toContain("Showing lines");
      expect(textOf(result)).toContain("Use offset=");
    });
  });

  describe("子目录文件", () => {
    it("应该读取子目录中的文件", async () => {
      createTestFile("subdir/file.txt", "Subdirectory file");

      const result = await tool.execute({ path: "subdir/file.txt" });

      expect(textOf(result)).toBe("Subdirectory file");
    });
  });

  describe("特殊字符", () => {
    it("应该读取Unicode内容", async () => {
      const content = "你好世界 🌍";
      createTestFile("unicode.txt", content);

      const result = await tool.execute({ path: "unicode.txt" });

      expect(textOf(result)).toBe(content);
    });
  });

  describe("错误处理", () => {
    it("应该处理文件不存在", async () => {
      await expect(tool.execute({ path: "nonexistent.txt" })).rejects.toThrow();
    });

    it("应该处理目录路径", async () => {
      createTestFile("dir/file.txt", "content");

      await expect(tool.execute({ path: "dir" })).rejects.toThrow();
    });
  });

  describe("截断信息", () => {
    it("应该返回截断详情", async () => {
      const lines = Array.from({ length: 3000 }, (_, i) => `Line ${i + 1}`);
      createTestFile("truncation.txt", lines.join("\n"));

      const result = await tool.execute({ path: "truncation.txt" });

      expect(result.details).toBeDefined();
    });

    it("不截断时应标记truncated为false", async () => {
      createTestFile("short-file.txt", "Short content");

      const result = await tool.execute({ path: "short-file.txt" });

      expect(result.details).toBeDefined();
      expect((result.details as any).truncation.truncated).toBe(false);
    });
  });
});
