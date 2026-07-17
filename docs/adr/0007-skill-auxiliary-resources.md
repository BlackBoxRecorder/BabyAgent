# Skill 目录支持辅助资源

Skill 目录除了 `SKILL.md` 外，可以包含任意辅助文件（scripts、templates、data 等）。当加载 skill 内容时，Markdown 中的相对路径链接自动改写为绝对路径，使 Agent 能通过工具访问这些资源。

## Considered Options

**纯文本路径重写** — 使用正则匹配 `scripts/foo.sh` 这类裸路径并改写为绝对路径。否决：误匹配风险高（普通文档中提到 `file.txt` 不一定是 skill 内文件），且上下文头已提供 LLM 根目录信息。

**PATH 注入** — 将 skill 的 `scripts/` 目录加入 PATH，让 LLM 可以直接执行脚本名。否决：多 skill 同名脚本冲突，安全风险；重写后的绝对路径已经可用。

**在 SkillTool / Coordinator 层重写** — 在 Agent 注入 system message 前做路径改写。否决：两个注入点（Skill Tool 自动调用、`/skill:name` 命令行）需要各自处理，不如在 SkillManager 统一处理。

## Decision

在 `SkillManager.readSkillContent()` 中统一处理路径重写：

1. **注入根目录上下文头** — 在返回内容顶部添加 `> **Skill 根目录**: /absolute/path/to/skill/dir`
2. **重写 Markdown 链接和图片** — 匹配 `[text](relative/path)` 和 `![alt](relative/path)`，将相对路径（不以 `http`、`/`、`#` 开头）用 `path.resolve(skillDir, relPath)` 改写为绝对路径
3. **不处理纯文本路径** — 靠上下文头让 LLM 自己拼接
4. **Content hash 使用原始内容** — hash 改写前的内容，保证跨机器去重一致

目录结构完全开放，无白名单限制 — skill 作者可以自由组织文件结构。

## Consequences

- Skill 系统从"单文件加载"变为"目录感知" — `skillDir` 成为一等概念，`SkillManager` 需要持有目录到 skill 的映射
- `readSkillContent` 的返回值不再等于 SKILL.md 原始内容，而是改写后的版本；但 content hash 仍追踪原始内容
- `contentCache` 中存储改写后的内容（带绝对路径），正常使用不受影响
- 跨机器共享 sessions（session 持久化中保存了 skill system message）时，可能会因为绝对路径不同导致该机器上的文件引用失效 — 这是可接受的，因为 session 本身就有环境耦合性
