# opencode-rules

[![npm version](https://img.shields.io/npm/v/opencode-rules)](https://www.npmjs.com/package/opencode-rules)
[![npm downloads](https://img.shields.io/npm/dm/opencode-rules)](https://www.npmjs.com/package/opencode-rules)

A lightweight OpenCode plugin that discovers and injects markdown rule files into AI agent system prompts, enabling flexible behavior customization without per-project configuration.

## Overview

opencode-rules automatically loads rule files from standard directories and integrates them into AI agent prompts, allowing you to:

- Define global coding standards that apply across all projects
- Create project-specific rules for team collaboration
- Apply conditional rules based on file patterns, prompt keywords, available tools, model, agent, branch, OS, CI, and more
- Control matching behavior with `match: any` (default) or `match: all`
- Maintain zero-configuration workflow with sensible defaults

This approach allows you to dynamically include rules automatically like style guides for specific languages,
guidance on specific actions, etc. Unlike skills, which are called on by the agent, rules use a simple matching
approach.

## Features

- **Dual-format support**: Load rules from both `.md` and `.mdc` files
- **Conditional rules**: Apply rules based on file paths, prompt keywords, or available tools
- **Runtime filtering**: Filter rules by model, agent, command, project type, git branch, OS, and CI
- **Branch glob patterns**: Match branches using glob patterns (e.g., `feature/*`, `release/**`)
- **Matching modes**: Use `match: any` (default) for OR logic or `match: all` for AND logic
- **Keyword matching**: Apply rules when the user's prompt contains specific keywords
- **Tool-based rules**: Apply rules only when specific MCP tools are available
- **Global and project-level rules**: Define rules at both system and project scopes
- **Context-aware injection**: Rules filtered by extracted file paths and user prompts
- **Zero-configuration**: Works out of the box with XDG Base Directory specification
- **TypeScript-first**: Built with TypeScript for type safety and developer experience
- **Performance optimized**: Efficient file discovery and minimal startup overhead

## Quick Start

### Installation

Add the plugin to your opencode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-rules@latest"]
}
```

### Create Your First Rule

1. Create the global rules directory:

   ```bash
   mkdir -p ~/.config/opencode/rules
   ```

2. Add a simple rule file:

   ```bash
   cat > ~/.config/opencode/rules/coding-standards.md << 'EOF'
   # Coding Standards

   - Use meaningful variable names
   - Follow the project's code style guide
   - Write self-documenting code
   EOF
   ```

That's it! The rule will now be automatically injected into all AI agent prompts.

## Configuration

### Rule Discovery Locations

Rules are automatically discovered from these directories (including all subdirectories):

1. **Global rules**: `$XDG_CONFIG_HOME/opencode/rules/` (typically `~/.config/opencode/rules/`)
2. **Project rules**: `.opencode/rules/` (in your project root)

Both directories are scanned recursively, allowing you to organize rules into subdirectories.

### Supported File Formats

- `.md` - Standard markdown files with optional metadata
- `.mdc` - Markdown files with optional metadata

## Usage Examples

### Basic Rule File

Create `~/.config/opencode/rules/naming-convention.md`:

```markdown
# Naming Convention Rules

- Use camelCase for variables and functions
- Use PascalCase for classes and interfaces
- Use UPPER_SNAKE_CASE for constants
- Prefix private properties with underscore
```

### Conditional Rule with Metadata

Create `~/.config/opencode/rules/typescript.mdc`:

```markdown
---
globs:
  - '**/*.ts'
  - '**/*.tsx'
---

# TypeScript Best Practices

- Always use `const` and `let`, avoid `var`
- Use interfaces for object types
- Add type annotations for function parameters
- Avoid `any` type without justification
- Enable strict mode in tsconfig.json
```

This rule only applies when processing TypeScript files.

### Keyword-Based Rule

Create `~/.config/opencode/rules/testing.mdc`:

```markdown
---
keywords:
  - 'testing'
  - 'unit test'
  - 'jest'
  - 'vitest'
---

# Testing Best Practices

- Write tests before implementing features (TDD)
- Use descriptive test names that explain the expected behavior
- Mock external dependencies
- Aim for high test coverage on critical paths
```

This rule applies when the user's prompt mentions testing-related terms.

### Tool-Based Rule

Create `~/.config/opencode/rules/websearch.mdc`:

```markdown
---
tools:
  - 'mcp_websearch'
  - 'mcp_codesearch'
---

# Web Search Best Practices

- Always verify search results with multiple sources
- Prefer official documentation over third-party tutorials
- Check publication dates for time-sensitive information
```

This rule only applies when the websearch or codesearch MCP tools are available.

NOTE: Due to limitations on how opencode provides tools via the SDK, individual
MCP tools cannot be matched. Only built-in tools, plugin tools, and whole MCPs
can be matched.

### Combined Globs and Keywords Rule

Create `~/.config/opencode/rules/test-files.mdc`:

```markdown
---
globs:
  - '**/*.test.ts'
  - '**/*.spec.ts'
keywords:
  - 'testing'
---

# Test File Standards

- Use `describe` blocks to group related tests
- Use `it` or `test` with clear descriptions
- Follow AAA pattern: Arrange, Act, Assert
```

This rule applies when EITHER a test file is in context OR the user mentions testing (OR logic).

### Combined Tools with Other Conditions

Create `~/.config/opencode/rules/lsp-typescript.mdc`:

```markdown
---
tools:
  - 'mcp_lsp'
globs:
  - '**/*.ts'
keywords:
  - 'type checking'
---

# LSP-Enabled TypeScript Development

- Use LSP hover to check inferred types
- Navigate to definitions using goToDefinition
- Find all references before refactoring
```

This rule applies when the LSP tool is available OR TypeScript files are in context OR the user mentions type checking.

### Runtime Environment Filtering

Create `~/.config/opencode/rules/feature-branch-dev.mdc`:

```markdown
---
model:
  - gpt-5.3-codex
  - claude-sonnet-4
agent:
  - programmer
branch:
  - feature/*
os:
  - linux
  - darwin
ci: false
match: all
---

# Feature Branch Development

When working on feature branches locally:

- Create atomic commits with clear messages
- Run tests before pushing
- Keep changes focused and reviewable
```

This rule uses `match: all` and only applies when ALL conditions are met: specific model, programmer agent, feature branch, Unix OS, and not in CI.

### Organized Rules with Subdirectories

You can organize rules into subdirectories for better management. Rules are discovered recursively from all subdirectories:

```
~/.config/opencode/rules/
├── coding-standards.md        # Always applied
├── typescript/
│   ├── general.md             # TypeScript general rules
│   └── react.mdc              # React-specific rules (conditional)
├── testing/
│   └── vitest.md              # Testing guidelines
└── security/
    └── api-keys.md            # Security rules
```

Hidden directories (starting with `.`) are automatically excluded from discovery.

### Project-Specific Rules

Create `.opencode/rules/react-components.mdc` in your project:

```markdown
---
globs:
  - 'src/components/**/*.tsx'
---

# React Component Guidelines

- Use functional components with hooks
- Export components as named exports
- Include PropTypes or TypeScript interfaces
- Use React.memo for expensive components
- Co-locate styles with components
```

## Metadata Format

Both `.md` and `.mdc` files support optional YAML metadata for conditional rule application:

```yaml
---
# Legacy filters
globs:
  - 'src/**/*.ts'
  - 'lib/**/*.js'
keywords:
  - 'refactoring'
  - 'cleanup'
tools:
  - 'mcp_websearch'
  - 'mcp_lsp'
# Runtime environment filters
model:
  - gpt-5.3-codex
  - claude-sonnet-4
agent:
  - programmer
command:
  - /plan
  - /review
project:
  - node
  - monorepo
branch:
  - main
  - feature/*
os:
  - linux
  - darwin
ci: false
# Matching mode
match: any
---
```

### Supported Fields

#### Legacy Filters

- `globs` (optional): Array of glob patterns for file-based matching
  - Rule applies when any file in context matches a pattern
- `keywords` (optional): Array of keywords for prompt-based matching
  - Rule applies when the user's prompt contains any keyword
  - Case-insensitive, word-boundary matching (e.g., "test" matches "testing")
  - Does NOT match mid-word (e.g., "test" does NOT match "contest")
- `tools` (optional): Array of tool IDs for tool-availability matching
  - Rule applies when any listed tool is available to the agent
  - Uses exact string matching against tool IDs (e.g., `mcp_websearch`, `mcp_bash`)
  - Enable debug logging (`OPENCODE_RULES_DEBUG=1`) to see available tool IDs

#### Runtime Environment Filters

- `model` (optional): Array of model IDs to match against the current LLM
  - Example: `['gpt-5.3-codex', 'claude-sonnet-4']`
- `agent` (optional): Array of agent types to match
  - Example: `['programmer', 'planner']`
- `command` (optional): Array of slash commands to match
  - Example: `['/plan', '/review']`
- `project` (optional): Array of project type tags to match
  - Detected automatically from marker files (e.g., `package.json` -> `node`)
  - Supported tags: `node`, `python`, `go`, `rust`, `monorepo`, `browser-extension`
- `branch` (optional): Array of git branch patterns to match
  - Supports exact names and glob patterns (e.g., `feature/*`, `release/**`)
  - Uses minimatch for glob matching
- `os` (optional): Array of operating systems to match
  - Values: `linux`, `darwin`, `win32`
- `ci` (optional): Boolean to match CI environment
  - `true` matches when running in CI, `false` matches when not in CI
- `match` (optional): Matching mode for multiple conditions
  - `any` (default): Rule applies if ANY declared condition matches
  - `all`: Rule applies only if ALL declared conditions match

**Note:** When a runtime context value is unavailable (e.g., not in a git repository), that dimension is treated as a non-match.

### Matching Behavior

- **No metadata**: Rule applies unconditionally (always included)
- **Only globs**: Rule applies when any context file matches
- **Only keywords**: Rule applies when the user's prompt contains any keyword
- **Only tools**: Rule applies when any listed tool is available
- **Multiple conditions with `match: any` (default)**: Rule applies when ANY condition matches (OR logic across all fields)
- **Multiple conditions with `match: all`**: Rule applies only when ALL declared conditions match

## Glob Pattern Reference

The plugin uses `minimatch` for pattern matching:

| Pattern                       | Matches                                         |
| ----------------------------- | ----------------------------------------------- |
| `src/**/*.ts`                 | All TypeScript files in src and subdirectories  |
| `**/*.test.ts`                | All test files at any depth                     |
| `src/components/**/*.tsx`     | React components in components directory        |
| `*.json`                      | JSON files in root directory only               |
| `lib/{utils,helpers}/**/*.js` | JavaScript files in specific lib subdirectories |

## Included Skill: crafting-rules

This repository includes a `crafting-rules/` skill that teaches AI agents how to create well-formatted rules. The skill provides:

- **Rule format reference** - Frontmatter fields (`globs`, `keywords`, `tools`, `model`, `agent`, `command`, `project`, `branch`, `os`, `ci`, `match`) and markdown body structure
- **Matching strategy guidance** - When to use globs vs keywords vs runtime filters vs combinations
- **Pattern extraction workflow** - How to identify repeated conversation patterns that should become rules
- **Keyword safety guidelines** - Denylist of overly broad keywords to avoid, allowlist of safe alternatives, and an audit checklist

To use the skill, copy `skills/crafting-rules/` to `~/.config/opencode/skills/` or reference it directly. The skill triggers when users ask to create rules, codify preferences, or persist guidance across sessions.

## Development

### Project Structure

```
opencode-rules/
├── src/
│   ├── index.ts              # Main plugin entry point and exports
│   ├── runtime.ts            # OpenCodeRulesRuntime class (hook orchestration)
│   ├── runtime-context.ts    # Context-building helpers (filter context, project detection)
│   ├── runtime-chat.ts       # Chat message handling and text extraction
│   ├── rule-discovery.ts     # Rule file scanning and discovery
│   ├── rule-metadata.ts      # YAML frontmatter parsing
│   ├── rule-filter.ts        # Rule filtering logic (globs, keywords, tools, runtime)
│   ├── message-paths.ts      # Path extraction from messages
│   ├── message-context.ts    # User prompt extraction from message parts
│   ├── session-store.ts      # Per-session state management
│   ├── project-fingerprint.ts # Project type detection (node, python, etc.)
│   ├── mcp-tools.ts          # MCP tool ID extraction
│   ├── git-branch.ts         # Git branch detection
│   ├── debug.ts              # Debug logging utilities
│   ├── utils.ts              # Re-export facade for backwards compatibility
│   ├── test-fixtures.ts      # Shared test fixtures and builders
│   ├── index.test.ts         # Core unit tests
│   ├── index.rules.test.ts   # Rule filtering tests
│   ├── index.runtime.test.ts # Runtime behavior tests
│   └── index.integration.test.ts # Integration tests
├── docs/
│   └── rules.md              # Detailed usage documentation
├── openspec/                 # Project specifications and proposals
└── dist/                     # Compiled JavaScript output
```

#### Module Responsibilities

- **runtime.ts** - Orchestrates hooks (`tool.execute.before`, `chat.message`, `experimental.chat.*`)
- **runtime-context.ts** - Builds `RuleFilterContext` from session state and environment
- **runtime-chat.ts** - Extracts text from chat message parts for keyword matching
- **rule-discovery.ts** - Recursively scans directories for `.md`/`.mdc` rule files
- **rule-metadata.ts** - Parses YAML frontmatter into typed `RuleMetadata`
- **rule-filter.ts** - Evaluates rules against context (globs, keywords, tools, runtime filters)
- **message-paths.ts** - Extracts file paths from message content
- **session-store.ts** - Manages per-session state with LRU eviction
- **utils.ts** - Thin facade re-exporting from decomposed modules

### Build and Test

```bash
# Install dependencies
bun install

# Run tests in watch mode
bun run test

# Run tests once
bun run test:run

# Build the project
bun run build

# Watch for changes and rebuild
bun run dev

# Format code
bun run format

# Lint code
bun run lint
```

### Tech Stack

- **TypeScript** - Type-safe development
- **@opencode-ai/plugin** - OpenCode plugin framework
- **Vitest** - Fast unit testing
- **Prettier** - Code formatting
- **ESLint** - Linting and code quality

## Architecture

This plugin uses OpenCode's hook system for incremental, stateful rule injection:

### Hook-Based Approach

1. **`tool.execute.before`** - Authoritative path capture from tool execution
   - Fires before each tool runs (read, edit, write, glob, grep, etc.)
   - Captures `filePath` or `path` arguments authoritative from the tool definition
   - Updates session state with normalized, verified context paths
   - Provides real-time context as tools are executed

2. **`chat.message`** - Incremental user prompt capture
   - Fires as each user message arrives
   - Extracts and stores the latest user prompt text
   - Enables keyword-based rule matching across the conversation flow

3. **`experimental.chat.messages.transform`** - One-time seeding fallback
   - Fires before the first LLM call only (skipped on subsequent turns)
   - Seeds session state from full message history if needed
   - Provides fallback context extraction from all visible messages
   - Ensures rules apply even if initial context wasn't captured by tool hooks

4. **`experimental.chat.system.transform`** - Rule injection and filtering
   - Fires before each LLM system prompt is constructed
   - Receives full runtime filter context: model, agent, command, project type, git branch, OS, and CI environment
   - Reads discovered rule files and filters based on:
     - Extracted file paths from session state (`globs`)
     - Latest user prompt (`keywords`)
     - Available tool IDs (`tools`)
     - Runtime environment (model, agent, command, project, branch, OS, CI)
   - Command is inferred from the leading slash token (first token) of the latest user prompt
   - Appends formatted rules to the system prompt

5. **`experimental.session.compacting`** - Compaction context preservation
   - Fires when a session is compacted (summarized)
   - Injects current context paths into the compaction context
   - Prevents rules from being lost during session compression

### Benefits Over Previous Approach

- **Incremental state tracking** - Builds context incrementally rather than rescanning messages each turn
- **Authoritative path capture** - Tool hooks provide verified file paths directly from the tool definition
- **Real-time responsiveness** - Context updates as tools execute and messages arrive
- **Compaction-aware** - Context persists through session compression
- **Efficient caching** - Rule discovery happens once at startup, not on every LLM call

### Experimental API Notice

This plugin depends on experimental OpenCode APIs:

- `experimental.chat.messages.transform` (fallback seeding)
- `experimental.chat.system.transform` (rule injection)
- `experimental.session.compacting` (compaction context)

These APIs may change in future OpenCode versions. Check OpenCode release notes when upgrading.

## How It Works

1. **Discovery**: Scan global and project directories for `.md` and `.mdc` files (at plugin init)
2. **Parsing**: Extract metadata from files with YAML front matter
3. **Tool Execution**: `tool.execute.before` hook captures file paths before tools run
4. **Message Flow**: `chat.message` hook updates user prompt as messages arrive
5. **Initial Seeding**: `experimental.chat.messages.transform` extracts context from message history once
6. **Rule Filtering**: `experimental.chat.system.transform` evaluates rules based on context and injects into system prompt
7. **Compaction Persistence**: `experimental.session.compacting` preserves context during session compression

## Performance

- Rule discovery performed once at plugin initialization
- Rule content cached with mtime-based invalidation for fast re-reads
- Incremental session state tracking (set of paths, not message rescanning)
- Per-session state pruned after 100 concurrent sessions to prevent memory growth
- Efficient glob matching with `minimatch`
- Tool-based path capture is non-blocking with minimal overhead
- Session context cleaned up when exceeded (LRU eviction)
- Minimal memory footprint with efficient state management

## Debug Logging

To enable debug logging, set the `OPENCODE_RULES_DEBUG` environment variable:

```bash
OPENCODE_RULES_DEBUG=1 opencode
```

This will log information about:

- Rule discovery (files found)
- Cache hits/misses
- Rule filtering (which rules are included/skipped)
- Available tool IDs (useful for writing `tools` conditions)

## Troubleshooting

### Rules Not Appearing

1. Verify directories exist: `~/.config/opencode/rules/` and/or `.opencode/rules/`
2. Check file extensions are `.md` or `.mdc`
3. Ensure files with metadata have properly formatted YAML
4. Test glob patterns using the `fileMatchesGlobs()` function

### Common Issues

- **Missing directories**: Plugin gracefully handles missing directories
- **Invalid YAML**: Metadata parsing errors are logged but don't crash the plugin
- **Pattern mismatches**: Use relative paths from project root for glob patterns

## Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass: `bun run test:run`
5. Format code: `bun run format`
6. Submit a pull request

### Development Guidelines

- Follow existing code style (Prettier configuration)
- Add comprehensive tests for new features
- Update documentation for API changes
- Use TypeScript for all new code

## See Also

- [OpenCode Documentation](https://docs.opencode.ai/)
