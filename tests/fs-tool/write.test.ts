import { describe, it, expect, beforeEach } from "vitest";
import {
  clearPlayground,
  createTestFile,
  fileExists,
  readFile,
  getTool,
} from "./setup.js";

describe("write工具", () => {
  let tool: ReturnType<typeof getTool>;

  beforeEach(() => {
    clearPlayground();
    tool = getTool("write");
  });

  function textOf(result: { content: Array<{ type: string }> }): string {
    return (result.content[0] as { type: "text"; text: string }).text;
  }

  describe("基本功能", () => {
    it("应该创建新文件并写入内容", async () => {
      const result = await tool.execute({
        path: "test.txt",
        content: "Hello, World!",
      });

      expect(textOf(result)).toContain("Successfully wrote");
      expect(fileExists("test.txt")).toBe(true);
      expect(readFile("test.txt")).toBe("Hello, World!");
    });

    it("应该覆盖现有文件", async () => {
      createTestFile("existing.txt", "Old content");

      await tool.execute({ path: "existing.txt", content: "New content" });

      expect(readFile("existing.txt")).toBe("New content");
    });

    it("应该写入空内容", async () => {
      await tool.execute({ path: "empty.txt", content: "" });

      expect(readFile("empty.txt")).toBe("");
    });

    it("应该写入多行内容", async () => {
      const content = "Line 1\nLine 2\nLine 3";
      await tool.execute({ path: "multiline.txt", content });

      expect(readFile("multiline.txt")).toBe(content);
    });
  });

  describe("目录创建", () => {
    it("应该自动创建父目录", async () => {
      await tool.execute({ path: "nested/dir/file.txt", content: "Nested" });

      expect(fileExists("nested/dir/file.txt")).toBe(true);
      expect(readFile("nested/dir/file.txt")).toBe("Nested");
    });

    it("应该创建多层嵌套目录", async () => {
      await tool.execute({ path: "a/b/c/d/file.txt", content: "Deep" });

      expect(fileExists("a/b/c/d/file.txt")).toBe(true);
    });
  });

  describe("特殊字符处理", () => {
    it("应该处理Unicode字符", async () => {
      const content = "你好世界";
      await tool.execute({ path: "unicode.txt", content });

      expect(readFile("unicode.txt")).toBe(content);
    });

    it("应该处理换行符和制表符", async () => {
      const content = "Line1\nLine2\tTabbed";
      await tool.execute({ path: "whitespace.txt", content });

      expect(readFile("whitespace.txt")).toBe(content);
    });
  });

  describe("返回值", () => {
    it("应该返回写入字节数", async () => {
      const result = await tool.execute({
        path: "bytes.txt",
        content: "Hello",
      });

      expect(textOf(result)).toContain("5 bytes");
    });

    it("应该返回文件路径", async () => {
      const result = await tool.execute({
        path: "path-test.txt",
        content: "test",
      });

      expect(textOf(result)).toContain("path-test.txt");
    });
  });

  describe("错误处理", () => {
    it("应该处理空路径", async () => {
      await expect(
        tool.execute({ path: "", content: "test" }),
      ).rejects.toThrow();
    });
  });

  describe("批量写入", () => {
    it("应该写入多个文件并能读取", async () => {
      for (let i = 0; i < 10; i++) {
        await tool.execute({
          path: `batch/file-${i}.txt`,
          content: `Content ${i}`,
        });
      }

      expect(fileExists("batch/file-9.txt")).toBe(true);
      expect(readFile("batch/file-0.txt")).toBe("Content 0");
    });
  });
});
