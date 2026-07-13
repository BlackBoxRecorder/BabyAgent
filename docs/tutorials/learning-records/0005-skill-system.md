# Lesson 5: Skill 系统

完成了第 5 课 Skill 系统的学习。理解了 Skill 如何通过 markdown 文件注入领域知识，以及 SkillManager 的扫描、加载和格式转换机制。

**关键收获：**
- Skill = YAML frontmatter + Markdown 指令，放在 `skills/<name>/SKILL.md`
- 三个 frontmatter 字段：name（可选，默认目录名）、description（必填）、disable-model-invocation（可选）
- 双目录搜索：用户级（~/.babyAgent/skills/）和项目级（cwd/.babyAgent/skills/），同名项目级覆盖
- formatSkillsForSystemPrompt() 将 skill 的 description 拼装为 XML 片段嵌入系统提示词
- disable-model-invocation: true 的 skill 不出现在系统提示词中，仅通过 /command 触发
- description 预加载（扫描时），正文 lazy 加载（LLM 决定使用时才读）
- Skill vs Tool 的本质区别：Skill 是文本指令（prompt），Tool 是可执行代码

**对后续学习的影响：** 最后一课将学习 Coordinator，它把 LLM Client、Agent、Tools、MCP、Skills 全部组装成完整的运行系统。
