import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { MemoryManager } from "../../src/memory.js";

describe("MemoryManager", () => {
  let tmpDir: string;
  let manager: MemoryManager;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `babyAgent-memory-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    manager = new MemoryManager(path.join(tmpDir, "memory.md"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("load", () => {
    it("should return empty data when file does not exist", async () => {
      const data = await manager.load();
      expect(data.items).toEqual([]);
    });

    it("should parse markdown items from file", async () => {
      const content = `# Memory

- I like concise answers
- Use Chinese
- Preferred model: deepseek-chat
`;
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.writeFile(path.join(tmpDir, "memory.md"), content, "utf-8");

      const data = await manager.load();
      expect(data.items).toEqual([
        "I like concise answers",
        "Use Chinese",
        "Preferred model: deepseek-chat",
      ]);
    });
  });

  describe("save", () => {
    it("should create the directory if it does not exist", async () => {
      const nestedDir = path.join(tmpDir, "nested", "config");
      const mgr = new MemoryManager(path.join(nestedDir, "memory.md"));
      await mgr.save({ items: [] });
      const stat = await fs.stat(nestedDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it("should write data to markdown file", async () => {
      const data = { items: ["I like concise answers"] };
      await manager.save(data);

      const content = await fs.readFile(
        path.join(tmpDir, "memory.md"),
        "utf-8",
      );
      expect(content).toContain("# Memory");
      expect(content).toContain("- I like concise answers");
    });
  });

  describe("addMemory", () => {
    it("should add an item to empty memory", async () => {
      const data = await manager.addMemory("I like concise answers");
      expect(data.items).toHaveLength(1);
      expect(data.items).toContain("I like concise answers");
    });

    it("should preserve insertion order across additions", async () => {
      await manager.addMemory("Use Chinese");
      await manager.addMemory("Preferred model: deepseek-chat");
      await manager.addMemory("Keep answers concise");

      const data = await manager.load();
      expect(data.items).toEqual([
        "Use Chinese",
        "Preferred model: deepseek-chat",
        "Keep answers concise",
      ]);
    });

    it("should not add duplicate items", async () => {
      await manager.addMemory("I like concise answers");
      await manager.addMemory("I like concise answers");

      const data = await manager.load();
      expect(
        data.items.filter((i) => i === "I like concise answers"),
      ).toHaveLength(1);
    });
  });

  describe("getMemoryText", () => {
    it("should return empty string for empty memory", async () => {
      const text = await manager.getMemoryText();
      expect(text).toBe("");
    });

    it("should return formatted markdown list", async () => {
      await manager.addMemory("Use Chinese");
      await manager.addMemory("Keep answers concise");

      const text = await manager.getMemoryText();
      expect(text).toContain("- Use Chinese");
      expect(text).toContain("- Keep answers concise");
    });
  });
});
