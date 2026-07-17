import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "os";

export interface MemoryData {
  items: string[];
}

export class MemoryManager {
  private memoryPath: string;

  constructor(memoryPath?: string) {
    this.memoryPath =
      memoryPath ?? path.join(os.homedir(), ".babyAgent", "memory.md");
  }

  async load(): Promise<MemoryData> {
    try {
      const content = await fs.readFile(this.memoryPath, "utf-8");
      return this._parseMarkdown(content);
    } catch {
      return { items: [] };
    }
  }

  async save(data: MemoryData): Promise<void> {
    await this._ensureDir();
    const content = this._formatMarkdown(data);
    await fs.writeFile(this.memoryPath, content, "utf-8");
  }

  async addMemory(text: string): Promise<MemoryData> {
    const data = await this.load();

    if (!data.items.includes(text)) {
      data.items.push(text);
    }

    await this.save(data);
    return data;
  }

  async getMemory(): Promise<string> {
    const data = await this.load();
    if (data.items.length === 0) {
      return "";
    }

    const lines: string[] = [];
    for (const item of data.items) {
      lines.push(`- ${item}`);
    }
    return lines.join("\n");
  }

  private _parseMarkdown(content: string): MemoryData {
    const items: string[] = [];
    const lines = content.split("\n");

    for (const line of lines) {
      const itemMatch = line.match(/^-\s+(.+)$/);
      if (itemMatch) {
        items.push(itemMatch[1].trim());
      }
    }

    return { items };
  }

  private _formatMarkdown(data: MemoryData): string {
    if (data.items.length === 0) {
      return "# Memory\n";
    }

    const lines: string[] = ["# Memory", ""];
    for (const item of data.items) {
      lines.push(`- ${item}`);
    }
    return lines.join("\n") + "\n";
  }

  private async _ensureDir(): Promise<void> {
    const dir = path.dirname(this.memoryPath);
    await fs.mkdir(dir, { recursive: true });
  }
}
