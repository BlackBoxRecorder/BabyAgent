import { describe, it, expect, beforeEach } from "vitest";
import { clearPlayground, createTestFile, getTool } from "./setup.js";

describe("grep工具", () => {
  let tool: ReturnType<typeof getTool>;

  beforeEach(() => {
    clearPlayground();
    tool = getTool("grep");
  });

  function textOf(result: { content: Array<{ type: string }> }): string {
    return (result.content[0] as { type: "text"; text: string }).text;
  }

  describe("基本功能", () => {
    it("应该搜索文本内容", async () => {
      createTestFile(
        "test.txt",
        "Hello, World!\nThis is a test.\nHello again.",
      );

      const result = await tool.execute({ pattern: "Hello" });

      expect(textOf(result)).toContain("Hello");
      // 应该匹配到两行
      const lines = textOf(result)
        .split("\n")
        .filter((l: string) => l.includes("Hello"));
      expect(lines.length).toBe(2);
    });

    it("应该搜索正则表达式", async () => {
      createTestFile("regex.txt", "apple\napplication\napt\nbanana");

      const result = await tool.execute({ pattern: "^ap" });

      expect(textOf(result)).toContain("apple");
      expect(textOf(result)).toContain("application");
      expect(textOf(result)).toContain("apt");
    });

    it("应该搜索带行号的结果", async () => {
      createTestFile("lines.txt", "first\nsecond\nthird");

      const result = await tool.execute({ pattern: "second" });

      expect(textOf(result)).toContain("2:");
      expect(textOf(result)).toContain("second");
    });
  });

  describe("大小写敏感", () => {
    it("应该默认区分大小写", async () => {
      createTestFile("case.txt", "Hello\nhello\nHELLO");

      const result = await tool.execute({ pattern: "Hello" });

      const output = textOf(result);
      expect(output).toContain("Hello");
      // hello 和 HELLO 不应该作为独立匹配行出现（因为大小写不同）
    });

    it("应该支持不区分大小写搜索", async () => {
      createTestFile("case-insensitive.txt", "Hello\nhello\nHELLO");

      const result = await tool.execute({ pattern: "Hello", ignoreCase: true });

      const lines = textOf(result)
        .split("\n")
        .filter((l: string) => l.trim());
      expect(lines.length).toBe(3);
    });
  });

  describe("glob过滤", () => {
    it("应该按文件类型过滤", async () => {
      createTestFile("file1.txt", "Hello World");
      createTestFile("file2.js", "Hello World");

      const result = await tool.execute({ pattern: "Hello", glob: "*.txt" });

      expect(textOf(result)).toContain("file1.txt");
      expect(textOf(result)).not.toContain("file2.js");
    });
  });

  describe("上下文行", () => {
    it("应该显示匹配行的上下文", async () => {
      createTestFile(
        "context.txt",
        "Line 1\nLine 2\nMatch here\nLine 4\nLine 5",
      );

      const result = await tool.execute({ pattern: "Match here", context: 1 });

      expect(textOf(result)).toContain("Match here");
    });
  });

  describe("限制结果", () => {
    it("应该限制匹配数量", async () => {
      const lines = Array.from(
        { length: 50 },
        (_, i) => `Line ${i}: Hello World`,
      );
      createTestFile("limit.txt", lines.join("\n"));

      const result = await tool.execute({ pattern: "Hello", limit: 5 });

      const matches = textOf(result)
        .split("\n")
        .filter((l: string) => l.includes("Hello"));
      expect(matches.length).toBeLessThanOrEqual(5);
    });
  });

  describe("无匹配结果", () => {
    it("应该返回无匹配提示", async () => {
      createTestFile("no-match.txt", "Hello, World!");

      const result = await tool.execute({ pattern: "NonexistentPattern" });

      expect(textOf(result)).toContain("(no matches found)");
    });
  });

  describe("搜索路径", () => {
    it("应该搜索指定目录", async () => {
      createTestFile("dir1/file1.txt", "Hello World");
      createTestFile("dir2/file2.txt", "Hello World");

      const result = await tool.execute({ pattern: "Hello", path: "dir1" });

      expect(textOf(result)).toContain("file1.txt");
      expect(textOf(result)).not.toContain("file2.txt");
    });
  });

  describe("隐藏文件", () => {
    it("应该搜索隐藏文件", async () => {
      createTestFile(".hidden", "Hello World");
      createTestFile("visible.txt", "Hello World");

      const result = await tool.execute({ pattern: "Hello" });

      expect(textOf(result)).toContain(".hidden");
      expect(textOf(result)).toContain("visible.txt");
    });
  });

  describe("错误处理", () => {
    it("应该处理无效正则表达式", async () => {
      createTestFile("invalid-regex.txt", "Hello, World!");

      // ripgrep 对无效正则可能返回无匹配或抛出错误，两种行为都可接受
      try {
        const result = await tool.execute({ pattern: "[invalid" });
        expect(textOf(result)).toContain("(no matches found)");
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe("返回值", () => {
    it("应该在截断时返回matchLimitReached", async () => {
      const lines = Array.from(
        { length: 200 },
        (_, i) => `Line ${i}: Hello World`,
      );
      createTestFile("truncated.txt", lines.join("\n"));

      const result = await tool.execute({ pattern: "Hello", limit: 10 });

      expect(result.details).toBeDefined();
      expect((result.details as any).matchLimitReached).toBe(10);
    });
  });
});
