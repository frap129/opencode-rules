# OpenCode Rules

This document explains how to use OpenCode Rules to inject custom instructions into the agent's system prompt. Rules are automatically discovered and injected via OpenCode's hook system, enabling context-aware rule filtering based on file paths, user prompts, and available tools.

## Rule Files

Rules are defined in Markdown files (`.md` or `.mdc`). These files can be located in two places:

- **Global Rules:** `~/.config/opencode/rules/`
- **Project Rules:** `.opencode/rules/` in the root of your project.

Both directories are scanned **recursively**, so you can organize your rules into subdirectories. Rule discovery happens once when the plugin initializes.

### Organizing Rules with Subdirectories

You can create subdirectories to group related rules:

```
~/.config/opencode/rules/
├── coding-standards.md       # Root-level rule (always applied)
├── languages/
│   ├── typescript.mdc        # TypeScript-specific (conditional)
│   └── python.mdc            # Python-specific (conditional)
├── frameworks/
│   ├── react.mdc             # React rules
│   └── nextjs.mdc            # Next.js rules
└── workflows/
    ├── testing.md            # Testing guidelines
    └── git.md                # Git commit conventions
```

Hidden files and directories (starting with `.`) are automatically excluded from discovery.

## Conditional Rules

You can define conditional rules in both `.md` and `.mdc` files using YAML frontmatter with `globs` and/or `keywords` fields.

### File-Based Conditions (globs)

The `globs` key contains a list of glob patterns. The rule applies if any file in the conversation context matches one of the patterns.

```markdown
---
globs:
  - 'src/components/**/*.ts'
---

This is a rule for TypeScript components.
```

### Prompt-Based Conditions (keywords)

The `keywords` key contains a list of keywords. The rule applies if the user's prompt contains any of the keywords (case-insensitive, word-boundary matching).

```markdown
---
keywords:
  - 'testing'
  - 'unit test'
  - 'jest'
---

Follow these testing best practices.
```

Keyword matching uses word boundaries, so:

- "test" matches "testing" (prefix match)
- "test" does NOT match "contest" (mid-word)

### Combined Conditions (OR logic)

You can use both `globs` and `keywords` together. The rule applies if EITHER condition matches:

```markdown
---
globs:
  - '**/*.test.ts'
keywords:
  - 'testing'
---

Testing standards for the project.
```

This rule applies when EITHER a test file is in context OR the user mentions testing.

### Unconditional Rules

If no `globs` or `keywords` are specified, the rule is applied unconditionally to all prompts.

## How Rules are Loaded and Injected

The plugin uses OpenCode's hook system to track context and inject rules:

1. **Context Tracking**:
   - `tool.execute.before` hook captures file paths as tools execute (read, edit, write, glob, grep, etc.)
   - `chat.message` hook captures the latest user prompt as messages arrive
   - `experimental.chat.messages.transform` hook seeds session state from message history on first call only

2. **Rule Injection**:
   - `experimental.chat.system.transform` hook evaluates all discovered rules against the accumulated context
   - Rules are filtered based on:
     - **File paths**: Glob patterns matched against files in context (from tool calls and message history)
     - **User prompts**: Keyword matching against the latest user message
     - **Available tools**: Exact match against tool IDs available in the current environment
   - Matching rules are formatted and appended to the system prompt

3. **Session Persistence**:
   - `experimental.session.compacting` hook preserves context paths during session compression
   - This ensures rules remain applicable after session compaction

## Rule Matching Examples

### Scenario 1: TypeScript File Context

- User edits `src/components/Button.tsx` (captured by `tool.execute.before`)
- Plugin evaluates rules with `globs: ['**/*.ts', '**/*.tsx']`
- TypeScript rules are injected into system prompt

### Scenario 2: User Mentions Testing

- User types prompt: "How do I write unit tests for this function?"
- `chat.message` hook captures the prompt
- Plugin evaluates rules with `keywords: ['testing', 'unit test']`
- Testing rules are injected into system prompt

### Scenario 3: Tool-Based Rules

- OpenCode provides websearch tool
- Plugin evaluates rules with `tools: ['mcp_websearch']`
- Web search best practices rules are injected

### Scenario 4: Combined Conditions

- A rule has both `globs: ['**/*.test.ts']` and `keywords: ['testing']`
- Rule is injected if EITHER condition matches (OR logic)
- File context OR user prompt will trigger the rule
