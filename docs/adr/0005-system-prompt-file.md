# Store system prompt in ~/.babyAgent/system_prompt.md

Currently, the system prompt is hardcoded in `app-factory.ts` and concatenated with skills. We want to make the system prompt user-configurable by reading it from a file.

## Considered Options

**Hardcoded prompt (current)** — Simple but not user-configurable. Users cannot modify the system prompt without changing code.

**Environment variable** — Store prompt in an env var. Limited by shell length limits and not easy to edit for multi-line prompts.

**Configuration file** — Store in a dedicated file (e.g., `system_prompt.md`). Easy to edit, supports multi-line markdown, and follows the existing pattern of `models.json`.

**Multiple files (global + project)** — Like skills, support both `~/.babyAgent/system_prompt.md` and `.babyAgent/system_prompt.md`. Adds complexity but allows per-project customization.

## Decision

We will store the system prompt in `~/.babyAgent/system_prompt.md` as a Markdown file. This follows the existing pattern of `models.json` and provides a single, user-editable file. The file will be created with a default prompt if it doesn't exist.

**Key design decisions:**
1. **Format**: Markdown file (`.md`) — allows users to use Markdown syntax for better organization
2. **Error handling**: If file read fails (e.g., permission issues), throw an error and exit — fail fast like `models.json`
3. **File monitoring**: Read only at startup — simple and reliable, user must restart after changes
4. **Skills concatenation**: Read system prompt from file, then append skills (as currently done). No placeholder syntax

## Implementation Details

**File path**: `~/.babyAgent/system_prompt.md`

**Default content**:
```
You are a helpful terminal AI agent. You have access to bash commands and filesystem tools. When performing tasks, use tools to gather information before responding. Be concise and direct.
```

**Loading logic** (`src/llm/system-prompt.ts`):
1. Check if file exists
2. If not, create `~/.babyAgent/` directory (if needed) and write default content
3. Read file content and trim whitespace
4. Throw error if file is empty or unreadable

**Integration** (`src/cli/app-factory.ts`):
1. Call `loadSystemPrompt()` during app startup
2. Append skills via `skillManager.formatSkillsForSystemPrompt()`
3. Pass combined prompt to Agent constructor

## Consequences

- Users can easily customize the system prompt by editing the Markdown file
- The default prompt provides a good starting point
- No need for placeholder syntax — skills are always appended
- If the file is deleted, it will be recreated with defaults on next startup
- The file path follows the existing `~/.babyAgent/` convention
- Fail-fast behavior ensures configuration issues are caught early
