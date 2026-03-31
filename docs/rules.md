# OpenCode Rules

This document explains how to use OpenCode Rules to inject custom instructions into the agent's system prompt. Rules are automatically discovered and injected via OpenCode's hook system, enabling context-aware rule filtering based on:

- **Legacy filters**: file paths (`globs`), user prompts (`keywords`), and available tools (`tools`)
- **Runtime filters**: model, agent, command, project type, git branch, OS, and CI environment
- **Match semantics**: `match: any` (default OR logic) or `match: all` (AND logic)

## Rule Files

Rules are defined in Markdown files (`.md` or `.mdc`). These files can be located in two places:

- **Global Rules:** `$OPENCODE_CONFIG_DIR/rules/` if set, otherwise `$XDG_CONFIG_HOME/opencode/rules/` (typically `~/.config/opencode/rules/`)
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

You can define conditional rules in both `.md` and `.mdc` files using YAML frontmatter with various filter fields.

### Legacy Filters

#### File-Based Conditions (globs)

The `globs` key contains a list of glob patterns. The rule applies if any file in the conversation context matches one of the patterns.

```markdown
---
globs:
  - 'src/components/**/*.ts'
---

This is a rule for TypeScript components.
```

#### Prompt-Based Conditions (keywords)

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

#### Tool-Based Conditions (tools)

The `tools` key contains a list of tool IDs. The rule applies if any listed tool is available in the current environment.

```markdown
---
tools:
  - 'mcp_websearch'
  - 'mcp_lsp'
---

Use LSP for type information and web search for documentation.
```

### Runtime Environment Filters

These filters match against the current runtime environment and session state.

#### Model Filter

The `model` key matches against the current LLM model ID:

```markdown
---
model:
  - gpt-5.3-codex
  - claude-sonnet-4
---

Instructions specific to these models.
```

#### Agent Filter

The `agent` key matches against the current agent type (e.g., `programmer`, `planner`):

```markdown
---
agent:
  - programmer
---

Programming-specific guidance.
```

#### Command Filter

The `command` key matches against the current slash command. The command is inferred from the leading slash token (first token) of the latest user prompt:

```markdown
---
command:
  - /plan
  - /review
---

Planning and review workflow guidance.
```

#### Project Filter

The `project` key matches against detected project type tags (e.g., `node`, `python`, `go`, `rust`, `monorepo`):

```markdown
---
project:
  - node
  - monorepo
---

Node.js monorepo best practices.
```

#### Branch Filter

The `branch` key matches against the current git branch name. Supports glob patterns:

```markdown
---
branch:
  - main
  - feature/*
  - release/**
---

Rules for main, feature branches, and release branches.
```

#### OS Filter

The `os` key matches against the current operating system (`linux`, `darwin`, `win32`):

```markdown
---
os:
  - linux
  - darwin
---

Unix-specific commands and paths.
```

#### CI Filter

The `ci` key matches against whether the environment is a CI system (boolean):

```markdown
---
ci: true
---

CI-specific build and test guidance.
```

### Combined Conditions (OR logic by default)

You can use multiple condition types together. By default (`match: any`), the rule applies if ANY condition matches:

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

### Requiring All Conditions (match: all)

Use `match: all` when you need every declared condition to match:

```markdown
---
model:
  - gpt-5.3-codex
agent:
  - programmer
branch:
  - feature/*
match: all
---

This rule only applies when ALL conditions match: specific model, programmer agent, AND a feature branch.
```

### Unconditional Rules

If no conditional fields are specified, the rule is applied unconditionally to all prompts.

## How Rules are Loaded and Injected

The plugin uses OpenCode's hook system to track context and inject rules:

1. **Context Tracking**:
   - `tool.execute.before` hook captures file paths as tools execute (read, edit, write, glob, grep, etc.)
   - `chat.message` hook captures the latest user prompt as messages arrive
   - `experimental.chat.messages.transform` hook seeds session state from message history on first call only

2. **Rule Injection**:
   - `experimental.chat.system.transform` hook evaluates all discovered rules against the accumulated context
   - Rules are filtered based on:
     - **File paths** (`globs`): Glob patterns matched against files in context
     - **User prompts** (`keywords`): Keyword matching against the latest user message
     - **Available tools** (`tools`): Exact match against tool IDs available in the environment
     - **Model** (`model`): Exact match against current LLM model ID
     - **Agent** (`agent`): Exact match against current agent type
     - **Command** (`command`): Exact match against current slash command
     - **Project** (`project`): Match against detected project type tags
     - **Branch** (`branch`): Exact or glob match against current git branch
     - **OS** (`os`): Exact match against current operating system
     - **CI** (`ci`): Boolean equality against CI environment detection
   - Missing runtime context (e.g., no git branch available) is treated as a non-match for that dimension
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

### Scenario 5: Runtime Environment Filtering

- A rule has `model: ['claude-sonnet-4']`, `branch: ['feature/*']`, and `match: all`
- Rule is only injected when BOTH the model matches AND the branch matches the glob
- If git branch cannot be determined, the branch dimension is a non-match

## Complete Example: Combined Legacy and Runtime Filters

This example demonstrates a rule using both legacy filters (`globs`, `keywords`) and new runtime filters:

```markdown
---
globs:
  - 'src/**/*.ts'
  - 'src/**/*.tsx'
keywords:
  - 'refactor'
  - 'cleanup'
model:
  - gpt-5.3-codex
  - claude-sonnet-4
agent:
  - programmer
project:
  - node
branch:
  - feature/*
  - main
os:
  - linux
  - darwin
ci: false
match: any
---

# TypeScript Refactoring Guidelines

When refactoring TypeScript code:

- Prefer composition over inheritance
- Extract reusable utilities to shared modules
- Add comprehensive type annotations
- Run tests after each significant change
```

With `match: any` (the default), this rule applies if ANY of the following is true:

- A TypeScript file is in conversation context
- User prompt contains "refactor" or "cleanup"
- Model is gpt-5.3-codex or claude-sonnet-4
- Agent type is programmer
- Project is detected as a Node.js project
- Git branch matches `feature/*` or is `main`
- OS is Linux or macOS
- Not running in CI

With `match: all`, the rule would only apply when ALL declared conditions match.
