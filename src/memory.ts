import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "os";

export interface MemoryData {
  items: string[];
}

export class MemoryManager {
  private filePath: string;

  constructor(memoryPath?: string) {
    if (memoryPath && memoryPath.endsWith(".md")) {
      this.filePath = memoryPath;
    } else {
      this.filePath = path.join(os.homedir(), ".babyAgent", "memory.md");
    }
  }

  async load(): Promise<MemoryData> {
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      return this._parse(content);
    } catch {
      return { items: [] };
    }
  }

  async save(data: MemoryData): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, this._format(data), "utf-8");
  }

  async addMemory(text: string): Promise<MemoryData> {
    const data = await this.load();
    if (!data.items.includes(text)) {
      data.items.push(text);
      await this.save(data);
    }
    return data;
  }

  async getMemoryText(): Promise<string> {
    const data = await this.load();
    if (data.items.length === 0) {
      return "";
    }
    return data.items.map((item) => `- ${item}`).join("\n");
  }

  private _parse(content: string): MemoryData {
    const items: string[] = [];
    for (const line of content.split("\n")) {
      const match = line.match(/^-\s+(.+)$/);
      if (match) {
        items.push(match[1].trim());
      }
    }
    return { items };
  }

  private _format(data: MemoryData): string {
    if (data.items.length === 0) {
      return "# Memory\n";
    }
    return ["# Memory", "", ...data.items.map((item) => `- ${item}`), ""].join(
      "\n",
    );
  }
}
