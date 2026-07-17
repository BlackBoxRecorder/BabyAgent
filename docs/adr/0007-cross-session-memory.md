# Cross-Session User Profile Memory

babyAgent needs cross-session memory to remember user preferences and build a long-term profile. This enables the agent to maintain context across different conversation sessions.

## Considered Options

**JSON file** — structured key-value storage. Ruled out because it's less human-readable and harder to manually edit. The project already uses Markdown for system prompts and documentation, so consistency matters.

**SQLite database** — relational storage with queries. Ruled out because it adds unnecessary complexity for simple preference storage. The file-based approach aligns with the existing SessionManager pattern.

**YAML frontmatter + Markdown** — machine-readable metadata with human-readable content. Ruled out because it introduces YAML parsing complexity and the user explicitly requested pure Markdown.

## Decision

Pure Markdown file at `~/.babyAgent/memory.md` with categorized sections using headings and bullet points. This approach:

- Is human-readable and manually editable
- Aligns with the project's existing Markdown usage (system_prompt.md)
- Is simple to parse with basic string operations
- Provides natural organization through sections

### Storage Format

```markdown
# Memory

## Language
- Use Chinese

## Response Style
- Keep answers concise

## Default Settings
- Preferred model: deepseek-chat

## Other Preferences
- I'm a backend developer
```

### Trigger Mechanisms

Two ways to add preferences:
1. Slash command: `/remember <content>` — explicit, structured
2. Natural language: `记住 <content>` — requires a space after "记住" to avoid false positives in normal conversation

### Injection Strategy

User preferences are appended to the system prompt when a new session is created. This ensures preferences are always visible to the LLM without additional retrieval logic.

### Categorization

Preferences are automatically categorized based on keyword matching:
- Language: language, english, chinese, 中文, 英语
- Response Style: 简洁, verbose, detailed, brief, concise
- Default Settings: model, temperature
- Preferences: preferred, like, want, use
- Other Preferences: unmatched preferences

## Consequences

- **User Experience**: Users can see and edit their preferences in a readable format
- **Performance**: Minimal overhead — profile is loaded once per session creation
- **Extensibility**: New categories can be added by extending the keyword patterns
- **Risk**: Natural language trigger may still have edge cases where normal conversation is misinterpreted

## Files Changed

- `src/memory.ts` — new MemoryManager class
- `src/cli/command.ts` — added /remember command handling
- `src/coordinator.ts` — injected memory into system prompt
- `tests/agent/memory.test.ts` — comprehensive tests