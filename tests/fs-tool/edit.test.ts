import { describe, it, expect, beforeEach } from "vitest";
import { clearPlayground, createTestFile, readFile, getTool } from "./setup.js";

describe("edit工具", () => {
  let tool: ReturnType<typeof getTool>;

  beforeEach(() => {
    clearPlayground();
    tool = getTool("edit");
  });

  function textOf(result: { content: Array<{ type: string }> }): string {
    return (result.content[0] as { type: "text"; text: string }).text;
  }

  describe("基本功能", () => {
    it("应该执行单次替换", async () => {
      createTestFile("test.txt", "Hello, World!");

      const result = await tool.execute({
        path: "test.txt",
        edits: [{ oldText: "World", newText: "Universe" }],
      });

      expect(textOf(result)).toContain("Successfully replaced 1 block(s)");
      expect(readFile("test.txt")).toBe("Hello, Universe!");
    });

    it("应该执行多个不同的替换", async () => {
      createTestFile("multi.txt", "Hello, World! How are you?");

      const result = await tool.execute({
        path: "multi.txt",
        edits: [
          { oldText: "Hello", newText: "Hi" },
          { oldText: "World", newText: "Universe" },
        ],
      });

      expect(textOf(result)).toContain("2 block(s)");
      expect(readFile("multi.txt")).toBe("Hi, Universe! How are you?");
    });
  });

  describe("边界情况", () => {
    it("应该将文本替换为空字符串", async () => {
      createTestFile("to-empty.txt", "Hello, World!");

      await tool.execute({
        path: "to-empty.txt",
        edits: [{ oldText: "World", newText: "" }],
      });

      expect(readFile("to-empty.txt")).toBe("Hello, !");
    });

    it("应该替换整行为新内容", async () => {
      createTestFile("full-line.txt", "Hello, World!");

      await tool.execute({
        path: "full-line.txt",
        edits: [{ oldText: "Hello, World!", newText: "Hi, Universe!" }],
      });

      expect(readFile("full-line.txt")).toBe("Hi, Universe!");
    });

    it("应该处理多行替换", async () => {
      createTestFile("multiline.txt", "Line 1\nLine 2\nLine 3");

      await tool.execute({
        path: "multiline.txt",
        edits: [
          { oldText: "Line 1\nLine 2", newText: "New Line 1\nNew Line 2" },
        ],
      });

      expect(readFile("multiline.txt")).toBe("New Line 1\nNew Line 2\nLine 3");
    });

    it("应该在文件中插入内容", async () => {
      createTestFile("insert.txt", "Start End");

      await tool.execute({
        path: "insert.txt",
        edits: [{ oldText: "Start End", newText: "Start Middle End" }],
      });

      expect(readFile("insert.txt")).toBe("Start Middle End");
    });
  });

  describe("错误处理", () => {
    it("应该处理文件不存在", async () => {
      await expect(
        tool.execute({
          path: "nonexistent.txt",
          edits: [{ oldText: "Hello", newText: "Hi" }],
        }),
      ).rejects.toThrow();
    });

    it("应该处理替换文本不存在", async () => {
      createTestFile("no-match.txt", "Hello, World!");

      await expect(
        tool.execute({
          path: "no-match.txt",
          edits: [{ oldText: "Nonexistent", newText: "Replacement" }],
        }),
      ).rejects.toThrow();
    });

    it("应该处理非唯一替换", async () => {
      createTestFile("non-unique.txt", "Hello, World! Hello, World!");

      await expect(
        tool.execute({
          path: "non-unique.txt",
          edits: [{ oldText: "Hello", newText: "Hi" }],
        }),
      ).rejects.toThrow();
    });

    it("应该处理空oldText", async () => {
      createTestFile("empty-old.txt", "Hello, World!");

      await expect(
        tool.execute({
          path: "empty-old.txt",
          edits: [{ oldText: "", newText: "Replacement" }],
        }),
      ).rejects.toThrow();
    });
  });

  describe("特殊字符", () => {
    it("应该处理正则表达式特殊字符", async () => {
      createTestFile("regex.txt", "Price: $100.00 (USD)");

      await tool.execute({
        path: "regex.txt",
        edits: [{ oldText: "$100.00", newText: "$200.00" }],
      });

      expect(readFile("regex.txt")).toBe("Price: $200.00 (USD)");
    });

    it("应该处理Unicode文本", async () => {
      createTestFile("unicode.txt", "你好世界");

      await tool.execute({
        path: "unicode.txt",
        edits: [{ oldText: "你好", newText: "您好" }],
      });

      expect(readFile("unicode.txt")).toBe("您好世界");
    });
  });

  describe("返回值", () => {
    it("应该返回正确的替换数量", async () => {
      createTestFile("count.txt", "A and B");

      const result = await tool.execute({
        path: "count.txt",
        edits: [
          { oldText: "A", newText: "X" },
          { oldText: "B", newText: "Y" },
        ],
      });

      expect(textOf(result)).toContain("2 block(s)");
    });

    it("应该返回diff信息", async () => {
      createTestFile("diff.txt", "Hello, World!");

      const result = await tool.execute({
        path: "diff.txt",
        edits: [{ oldText: "World", newText: "Universe" }],
      });

      expect(result.details).toBeDefined();
      expect((result.details as any).diff).toBeDefined();
      expect((result.details as any).patch).toBeDefined();
    });
  });
});
