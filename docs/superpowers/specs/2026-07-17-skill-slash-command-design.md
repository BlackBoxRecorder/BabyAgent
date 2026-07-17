# Skill 斜杠命令注册与调用

## 概述

将每个 skill 通过 `/skill:<name>` 语法注册为可自动补全和直接调用的斜杠命令。当前自动补全已实现，但命令处理器不识别 `/skill:<name>` 且无 skill 内容注入机制。

## 用户行为

| 输入 | 效果 |
|------|------|
| `/skill:grilling` | 注入 skill 指令到对话上下文，后续所有 turn 受该 skill 影响，直到 `/new` |
| `/skill:grilling 请审查` | 同上 + 立即将 `请审查` 作为本 turn 输入发送给 LLM |
| 先后激活多个 skill | 叠加模式 — 多个 skill 同时生效 |
| `/new` | 清除所有已激活 skill（session 重置） |

## 修改范围

| 文件 | 改动 |
|------|------|
| `src/tui/command.ts` | 新增 `skill_activate` 结果类型；解析 `/skill:<name> <prompt?>` |
| `src/coordinator.ts` | 新增 `activateSkill()` / `getActiveSkills()` 方法 |
| `src/tui/tui-loop.ts` | 处理 `skill_activate` 结果；状态栏显示已激活 skill |

## 数据流

```
用户输入: /skill:grilling 请审查
    │
    ▼
CombinedAutocompleteProvider → /ski 匹配到 skill（Tab 补全）
SkillAutocompleteProvider     → /skill: 列出所有 skill（↑↓ 选择，Tab 填充）
    │
    ▼ 编辑器内容: /skill:grilling 请审查
handleSubmit() → startsWith("/") → commandHandler.handle()
    │
    ▼
CommandHandler: 正则解析 → readSkillContent → { type: "skill_activate", name, content, prompt }
    │
    ▼
TuiLoop._handleCommandResult():
  coordinator.activateSkill(name, content)     ← 注入 system 消息到对话
  如果 prompt → executeTurn(prompt)            ← 立即发送
    │
    ▼
Coordinator → Agent → LLM（对话中包含 skill 指令）
```

## 详细实现

### 1. CommandHandler (`src/tui/command.ts`)

新增 `skill_activate` 结果类型：

```typescript
export type CommandResult =
  | { type: "display"; text: string }
  | { type: "action"; action: () => Promise<void> }
  | { type: "turn"; input: string }
  | { type: "unknown" }
  | { type: "noop" }
  | { type: "skill_activate"; name: string; content: string; prompt?: string };
```

`handle()` 方法中新增匹配（在 `/skill` noop 之前）：

```typescript
// /skill:<name> [prompt?]
const skillMatch = input.match(/^\/skill:(\S+)(?:\s+(.*))?$/);
if (skillMatch) {
  const [, name, prompt] = skillMatch;
  const content = await context.skillManager.readSkillContent(name).catch(() => null);
  if (!content) {
    return { type: "display", text: `Skill "${name}" not found` };
  }
  return { type: "skill_activate", name, content, prompt: prompt || undefined };
}
```

### 2. Coordinator (`src/coordinator.ts`)

新增两个方法：

```typescript
/**
 * 激活一个 skill，将其指令作为 system 消息注入到对话。
 * Session 级持久 — 直到 /new 重置。
 * 叠加模式 — 多次调用激活多个 skill。
 * 同一 skill 重复激活 → 替换旧内容。
 */
activateSkill(name: string, content: string): void {
  const messages = [...this.agent.getMessages()] as Message[];
  const existingIdx = messages.findIndex(
    (m) => m.role === "system" && (m as any)._skillName === name,
  );
  const skillMsg = {
    role: "system",
    content: `[Skill: ${name}]\n\n${content}`,
    _skillName: name,
  };
  if (existingIdx >= 0) {
    messages[existingIdx] = skillMsg;
  } else {
    const sysIdx = messages.findIndex((m) => m.role === "system");
    messages.splice(sysIdx + 1, 0, skillMsg);
  }
  this.agent.setMessages(messages as any);
}

/** 获取当前已激活的所有 skill 名称列表（供状态栏显示）。 */
getActiveSkills(): string[] {
  return (this.agent.getMessages() as any[])
    .filter((m) => m._skillName)
    .map((m) => m._skillName);
}
```

### 3. TuiLoop (`src/tui/tui-loop.ts`)

`_handleCommandResult()` 新增分支：

```typescript
case "skill_activate": {
  this.coordinator.activateSkill(result.name, result.content);
  const skill = this.skillManager.getSkill(result.name);
  const desc = skill ? ` — ${skill.description}` : "";
  this.addMessage(new Text(`[Skill "${result.name}" 已激活]${desc}`, 1, 0));
  this.updateStatusBar();
  if (result.prompt) {
    this.addMessage(new Text(
      `${ansi.cyan("You")} ${ansi.dim(">")} ${result.prompt}`, 0, 0, ansi.bgGray,
    ));
    await this.executeTurn(result.prompt);
  }
  break;
}
```

`_buildStatusText()` 增加已激活 skill 的显示：

```typescript
const activeSkills = this.coordinator.getActiveSkills();
const skillBadge = activeSkills.length > 0
  ? ansi.bold(ansi.magenta(`[Skills: ${activeSkills.join(", ")}]`)) + "  "
  : "";
```

## 自动补全

现有补全链路无需修改，已完整支持该交互：

- `CombinedAutocompleteProvider`：`/ski` → 匹配到 `skill` 条目，Tab 补全为 `/skill`
- `SkillAutocompleteProvider`：`/skill:` 前缀触发，列出所有 skill，↑↓ 选择，Tab 填充
- `triggerCharacters` 返回 `[":"]`，输入 `:` 时自动弹出补全列表

## 错误处理

| 场景 | 处理 |
|------|------|
| skill 不存在 | `readSkillContent()` 抛错，catch 后返回 display 提示 |
| SKILL.md 读取失败 | 同上 |
| `disableModelInvocation: true` | 正常处理（手动激活不受此限制） |
