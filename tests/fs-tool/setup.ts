import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalFileOperations } from "../../src/tools/fs/core/file-operations.js";
import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createGrepTool,
  createFindTool,
  createLsTool,
} from "../../src/tools/fs/adapters/standalone.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PLAYGROUND_DIR = join(__dirname, "playground");

/**
 * 清理playground目录中的所有内容
 * 只删除目录内的文件/子目录，保留 playground 目录本身
 */
export function clearPlayground(): void {
  // 确保目录存在
  if (!existsSync(PLAYGROUND_DIR)) {
    mkdirSync(PLAYGROUND_DIR, { recursive: true });
    return;
  }

  // 删除目录内的每个条目
  const entries = readdirSync(PLAYGROUND_DIR);
  for (const entry of entries) {
    const entryPath = join(PLAYGROUND_DIR, entry);
    rmSync(entryPath, { recursive: true, force: true });
  }
}

/**
 * 创建测试文件（同步操作，确保文件立即可用）
 */
export function createTestFile(relativePath: string, content: string): string {
  const fullPath = join(PLAYGROUND_DIR, relativePath);
  const dir = dirname(fullPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(fullPath, content, "utf-8");
  return fullPath;
}

/**
 * 创建测试目录
 */
export function createTestDir(relativePath: string): string {
  const fullPath = join(PLAYGROUND_DIR, relativePath);
  mkdirSync(fullPath, { recursive: true });
  return fullPath;
}

/**
 * 获取playground目录路径
 */
export function getPlaygroundPath(): string {
  return PLAYGROUND_DIR;
}

/**
 * 获取standalone工具实例
 */
export function getTool(toolName: string) {
  const ops = createLocalFileOperations();
  switch (toolName) {
    case "read":
      return createReadTool(PLAYGROUND_DIR, ops);
    case "write":
      return createWriteTool(PLAYGROUND_DIR, ops);
    case "edit":
      return createEditTool(PLAYGROUND_DIR);
    case "grep":
      return createGrepTool(PLAYGROUND_DIR);
    case "find":
      return createFindTool(PLAYGROUND_DIR);
    case "ls":
      return createLsTool(PLAYGROUND_DIR, ops);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

/**
 * 检查文件是否存在
 */
export function fileExists(relativePath: string): boolean {
  return existsSync(join(PLAYGROUND_DIR, relativePath));
}

/**
 * 读取文件内容（同步）
 */
export function readFile(relativePath: string): string {
  return readFileSync(join(PLAYGROUND_DIR, relativePath), "utf-8");
}
