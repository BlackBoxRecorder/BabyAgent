import { describe, it, expect, beforeEach } from "vitest";
import {
  clearPlayground,
  createTestFile,
  fileExists,
  readFile,
  getTool,
} from "./setup.js";

describe("集成测试", () => {
  beforeEach(() => {
    clearPlayground();
  });

  function textOf(result: { content: Array<{ type: string }> }): string {
    return (result.content[0] as { type: "text"; text: string }).text;
  }

  describe("write→read→edit 工作流", () => {
    it("应该支持完整的文件编辑工作流", async () => {
      const writeTool = getTool("write");
      const readTool = getTool("read");
      const editTool = getTool("edit");

      // 1. 写入文件
      await writeTool.execute({
        path: "workflow.txt",
        content: "Hello, World!\nThis is a test.\nGoodbye!",
      });

      // 2. 读取验证
      const readResult = await readTool.execute({ path: "workflow.txt" });
      expect(textOf(readResult)).toBe(
        "Hello, World!\nThis is a test.\nGoodbye!",
      );

      // 3. 编辑文件
      await editTool.execute({
        path: "workflow.txt",
        edits: [
          { oldText: "Hello, World!", newText: "Hi, Universe!" },
          { oldText: "Goodbye!", newText: "See you later!" },
        ],
      });

      // 4. 再次读取验证
      const finalResult = await readTool.execute({ path: "workflow.txt" });
      expect(textOf(finalResult)).toBe(
        "Hi, Universe!\nThis is a test.\nSee you later!",
      );
    });

    it("应该支持多次编辑", async () => {
      const writeTool = getTool("write");
      const editTool = getTool("edit");
      const readTool = getTool("read");

      await writeTool.execute({
        path: "version.txt",
        content: "Version 1.0\nFeature A\nFeature B",
      });

      await editTool.execute({
        path: "version.txt",
        edits: [{ oldText: "Version 1.0", newText: "Version 2.0" }],
      });

      await editTool.execute({
        path: "version.txt",
        edits: [
          { oldText: "Feature A", newText: "Feature A Enhanced" },
          { oldText: "Feature B", newText: "Feature B Improved" },
        ],
      });

      const result = await readTool.execute({ path: "version.txt" });
      expect(textOf(result)).toBe(
        "Version 2.0\nFeature A Enhanced\nFeature B Improved",
      );
    });
  });

  describe("write→grep→find 工作流", () => {
    it("应该支持文件搜索和内容搜索的组合", async () => {
      const writeTool = getTool("write");
      const grepTool = getTool("grep");
      const findTool = getTool("find");

      // 创建多个文件
      await writeTool.execute({
        path: "src/main.js",
        content: "function main() {\n  console.log('Hello');\n}",
      });
      await writeTool.execute({
        path: "src/utils.js",
        content: "function helper() {\n  return 'world';\n}",
      });
      await writeTool.execute({
        path: "test/main.test.js",
        content: "test('main', () => {});",
      });

      // find 查找所有 JS 文件
      const findResult = await findTool.execute({ pattern: "*.js" });
      expect(textOf(findResult)).toContain("main.js");
      expect(textOf(findResult)).toContain("utils.js");
      expect(textOf(findResult)).toContain("main.test.js");

      // grep 搜索包含 "Hello" 的文件
      const grepResult = await grepTool.execute({ pattern: "Hello" });
      expect(textOf(grepResult)).toContain("main.js");

      // grep 搜索特定目录
      const srcGrep = await grepTool.execute({
        pattern: "function",
        path: "src",
      });
      expect(textOf(srcGrep)).toContain("main.js");
      expect(textOf(srcGrep)).toContain("utils.js");
    });
  });

  describe("批量文件操作", () => {
    it("应该支持批量创建和编辑", async () => {
      const writeTool = getTool("write");
      const editTool = getTool("edit");
      const readTool = getTool("read");

      // 批量创建
      for (let i = 1; i <= 3; i++) {
        await writeTool.execute({
          path: `batch/file${i}.txt`,
          content: `Content ${i}`,
        });
      }

      // 验证创建
      for (let i = 1; i <= 3; i++) {
        expect(fileExists(`batch/file${i}.txt`)).toBe(true);
        expect(readFile(`batch/file${i}.txt`)).toBe(`Content ${i}`);
      }

      // 批量编辑
      for (let i = 1; i <= 3; i++) {
        await editTool.execute({
          path: `batch/file${i}.txt`,
          edits: [{ oldText: "Content", newText: "Updated" }],
        });
      }

      // 验证编辑
      for (let i = 1; i <= 3; i++) {
        expect(readFile(`batch/file${i}.txt`)).toBe(`Updated ${i}`);
      }
    });
  });

  describe("错误恢复", () => {
    it("应该在编辑失败后不影响后续操作", async () => {
      const writeTool = getTool("write");
      const editTool = getTool("edit");
      const readTool = getTool("read");

      await writeTool.execute({
        path: "recover.txt",
        content: "Original content",
      });

      // 编辑不存在的文本应该失败
      try {
        await editTool.execute({
          path: "recover.txt",
          edits: [{ oldText: "Nonexistent", newText: "Replacement" }],
        });
      } catch {
        // 预期失败
      }

      // 文件内容应保持不变
      const result = await readTool.execute({ path: "recover.txt" });
      expect(textOf(result)).toBe("Original content");

      // 后续有效编辑应成功
      await editTool.execute({
        path: "recover.txt",
        edits: [{ oldText: "Original content", newText: "Updated content" }],
      });

      expect(readFile("recover.txt")).toBe("Updated content");
    });
  });

  describe("目录结构操作", () => {
    it("应该支持创建和搜索嵌套目录结构", async () => {
      const writeTool = getTool("write");
      const findTool = getTool("find");
      const grepTool = getTool("grep");

      await writeTool.execute({
        path: "src/components/Button.js",
        content: "export function Button() {}",
      });
      await writeTool.execute({
        path: "src/components/Input.js",
        content: "export function Input() {}",
      });
      await writeTool.execute({
        path: "src/utils/helpers.js",
        content: "export function formatDate() {}",
      });

      // 查找所有 JS 文件
      const findResult = await findTool.execute({ pattern: "**/*.js" });
      expect(textOf(findResult)).toContain("Button.js");
      expect(textOf(findResult)).toContain("Input.js");
      expect(textOf(findResult)).toContain("helpers.js");

      // grep 搜索特定目录
      const componentGrep = await grepTool.execute({
        pattern: "export",
        path: "src/components",
      });
      expect(textOf(componentGrep)).toContain("Button.js");
      expect(textOf(componentGrep)).toContain("Input.js");
    });
  });
});
