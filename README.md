# opencode-rules

[![npm version](https://img.shields.io/npm/v/opencode-rules)](https://www.npmjs.com/package/opencode-rules)
[![npm downloads](https://img.shields.io/npm/dm/opencode-rules)](https://www.npmjs.com/package/opencode-rules)

A lightweight OpenCode plugin that discovers markdown rule files and delivers them into AI agent conversations, enabling flexible behavior customization without per-project configuration.

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

> [!NOTE]
> The name `opencode-rules` is to be concise about what this plugin does. It is in no way affiliated with Anomaly Co. or
> the official OpenCode project.

## Features

- **Dual-format support**: Load rules from both `.md` and `.mdc` files
- **Conditional rules**: Apply rules based on file paths, file content, prompt keywords, or available tools
- **Runtime filtering**: Filter rules by model, agent, command, project type, git branch, OS, and CI
- **Branch glob patterns**: Match branches using glob patterns (e.g., `feature/*`, `release/**`)
- **Matching modes**: Use `match: any` (default) for OR logic or `match: all` for AND logic
- **Keyword matching**: Apply rules when the user's prompt contains specific keywords
- **File-content matching**: Apply rules when observed file text contains literal substrings (`fileContains`)
- **Tool-based rules**: Apply rules only when specific MCP tools are available
- **Global and project-level rules**: Define rules at both system and project scopes
- **Context-aware delivery**: Rules filtered by extracted file paths and user prompts
- **Hook-based triggers**: Reactively fire rules when tools are invoked via `PreToolUse` (before execution, optionally blocking) and `PostToolUse` (after execution, delivering corrective guidance on the next turn)
- **Zero-configuration**: Works out of the box with XDG Base Directory specification
- **TypeScript-first**: Built with TypeScript for type safety and developer experience
- **Performance optimized**: Efficient file discovery and minimal startup overhead
- **TUI sidebar**: Real-time sidebar in the OpenCode TUI showing rule status with active/inactive indicators

## Quick Start

### Installation

```bash
opencode plugin opencode-rules@latest --global
```

<details>
<summary>Manual installation</summary>

Add the plugin to your opencode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-rules@latest"]
}
```

To enable the TUI sidebar, add the same plugin entry to your TUI config:

```json
// ~/.config/opencode/tui.json
{
  "plugin": ["opencode-rules@latest"]
}
```

</details>

### Beta Channel

Pre-release versions from the `dev` branch are published under the `beta` npm dist-tag. These include upcoming features and fixes but may be unstable.

```bash
opencode plugin opencode-rules@beta --global
```

> [!WARNING]
> Beta releases track the `dev` branch and may contain breaking changes or bugs. Test thoroughly in non-critical workflows before using.

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

That's it! The rule will now be automatically delivered to all AI agent conversations.

## How It Works

1. **Discovery**: Scan global and project directories for `.md` and `.mdc` files (at plugin init)
2. **Parsing**: Extract metadata from files with YAML front matter
3. **File Observations**: Successful live Read, Write, Edit, Apply Patch, and path-associated LSP `tool.execute.after` events create File observations. Historical tool parts do not recreate File observations or select new file-scoped Rules.
4. **History Seeding**: `experimental.chat.messages.transform` rebuilds the path-only Working context for compaction from message history once and lets RuleDelivery rebuild identity-ledger evidence from synthetic delivery metadata when resuming a session
5. **Earliest Dispatch**: A newly Matched Durable Rule in the file-observation family (`globs`, `fileContains`, or both) is admitted immediately through an awaited `session.prompt({ noReply: true })`; pending guidance is included transiently in the next usable dispatch and persistence retries there. Initial Durable matches still append to `chat.message`.
6. **Rule Delivery**: Each injection event is one `<system-message>` block with one plugin preamble and a `<rule name="...">` block per rule. The name comes from frontmatter `name` or the filename stem. Session-durable rules (unconditional, `globs`, `fileContains`, `keywords`, `command`, `project`, `os`, and `ci`) are appended once to the user message as one persisted synthetic text part via `chat.message`, hidden in the TUI but included in provider requests so the system prompt stays byte-stable for prompt caching. Agent, `model`, `branch`, and `tools` rules are appended only to the transformed model request as one transient synthetic message per matching turn, so changing agent or model does not leave stale rule text in new history. Path-based deduplication applies only to durable delivery.
7. **State Persistence**: Matched rule paths are written to `~/.opencode/state/opencode-rules/{sessionId}.json` for TUI consumption
8. **Compaction Persistence**: `experimental.session.compacting` preserves Working-context paths and invalidates the durable delivery ledger; the next transformed request rebuilds it from surviving parts so missing durable rules are re-appended, while ephemeral rules continue to be recomputed per request

## Performance

- Rule discovery performed once at plugin initialization
- Rule content cached with mtime-based invalidation for fast re-reads
- Incremental session state tracking (set of paths, not message rescanning)
- Per-session state pruned after 100 concurrent sessions to prevent memory growth
- Efficient glob matching with `minimatch`
- Tool-based path capture is non-blocking with minimal overhead
- Session context cleaned up when exceeded (LRU eviction)
- Minimal memory footprint with efficient state management

## Configuration

### Rule Discovery Locations

Rules are automatically discovered from these directories (including all subdirectories):

1. **Global rules**: `$OPENCODE_CONFIG_DIR/rules/` if set, otherwise `$XDG_CONFIG_HOME/opencode/rules/` (typically `~/.config/opencode/rules/`)
2. **Project rules**: `.opencode/rules/` (in your project root)

Both directories are scanned recursively, allowing you to organize rules into subdirectories.

### Supported File Formats

- `.md` - Standard markdown files with optional metadata
- `.mdc` - Markdown files with optional metadata

## Metadata Format

Both `.md` and `.mdc` files support optional YAML metadata for conditional rule application:

```yaml
---
globs:
  - 'src/**/*.ts'
  - 'lib/**/*.js'
fileContains:
  - 'unsafe {'
keywords:
  - 'refactoring'
  - 'cleanup'
tools:
  - 'mcp_websearch'
  - 'mcp_lsp'
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

- `globs` (optional): Array of glob patterns for file-based matching
  - Rule applies when any file in context matches a pattern
- `fileContains` (optional): String or array of literal substrings to find in observed file content
  - Rule applies when one observed file's path matches `globs` (if declared) AND the same observation's text contains any literal (OR across literals)
  - Case-sensitive literal matching; regex metacharacters have no special meaning and literals may span lines
  - Usable without `globs` to match content alone; a declared field with no valid literal makes the rule never match (fail-closed, with a warning)
  - Observed only from successful Read, Write, Edit, Apply Patch, and LSP tool events
- `keywords` (optional): Array of keywords for prompt-based matching
  - Rule applies when the user's prompt contains any keyword
  - Case-insensitive, word-boundary matching (e.g., "test" matches "testing")
  - Does NOT match mid-word (e.g., "test" does NOT match "contest")
- `tools` (optional): Array of tool IDs for tool-availability matching
  - Rule applies when any listed tool is available to the agent
  - Uses exact string matching against tool IDs (e.g., `mcp_websearch`, `mcp_bash`)
  - Enable debug logging (`OPENCODE_RULES_DEBUG=1`) to see available tool IDs
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

> [!NOTE]
> When a runtime context value is unavailable (e.g., not in a git repository), that dimension is treated as a non-match.

### Matching Behavior

- **No metadata**: Rule applies unconditionally (always included)
- **Only globs**: Rule applies when any observed file's path matches
- **Only fileContains**: Rule applies when any observed file's text contains a literal
- **globs + fileContains**: One file-observation family — a single observed file must satisfy both (AND)
- **Only keywords**: Rule applies when the user's prompt contains any keyword
- **Only tools**: Rule applies when any listed tool is available
- **Multiple conditions with `match: any` (default)**: Rule applies when ANY condition matches (OR logic across all fields; the file-observation family counts as one check)
- **Multiple conditions with `match: all`**: Rule applies only when ALL declared conditions match

> [!NOTE]
> Normalized File observations from successful live Read, Write, Edit, Apply Patch, and path-associated LSP events are the sole source for `globs` and `fileContains`. Prose path mentions in messages and excluded tools' arguments/results (grep, glob, bash, ...) do not contribute paths, and historical tool parts never recreate File observations.

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

- **Rule format reference** - Frontmatter fields (`globs`, `fileContains`, `keywords`, `tools`, `model`, `agent`, `command`, `project`, `branch`, `os`, `ci`, `match`) and markdown body structure
- **Matching strategy guidance** - When to use globs vs keywords vs runtime filters vs combinations
- **Pattern extraction workflow** - How to identify repeated conversation patterns that should become rules
- **Keyword safety guidelines** - Denylist of overly broad keywords to avoid, allowlist of safe alternatives, and an audit checklist

To use the skill, copy `skills/crafting-rules/` to `~/.config/opencode/skills/` or reference it directly. The skill triggers when users ask to create rules, codify preferences, or persist guidance across sessions.

## Usage Examples

For real-world examples, see the [`.opencode/rules/`](.opencode/rules/) directory in this repository.

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

### File-Content Rule (fileContains)

Create `~/.config/opencode/rules/rust-unsafe.mdc`:

```markdown
---
globs:
  - '**/*.rs'
fileContains: 'unsafe {'
---

# Rust Unsafe Review

- Call wrap() and other FFI helpers when touching unsafe code.
- Document every unsafe block with a SAFETY comment.
```

This rule is delivered when a successfully observed `.rs` file contains `unsafe {` — for
example after the agent reads or writes a matching file. The path and content checks
compose over the **same** file observation: a non-Rust file containing the literal or a
Rust file without it does not match. `fileContains` is durable: once delivered, later
observations never retract it.

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

## Development

### Project Structure (Abridged)

The following shows the key source modules. Additional test files (`*.test.ts`) and type-checking utilities exist but are omitted for brevity.

```
opencode-rules/
├── src/
│   ├── index.ts              # Main plugin entry point and exports
│   ├── runtime.ts            # OpenCodeRulesRuntime class (hook orchestration)
│   ├── file-observation-context.ts # Runtime-owned per-session File-observation store (bounded LRU; feeds globs/fileContains matching and earliest-dispatch admission; live events only)
│   ├── session-working-context.ts # Runtime-owned Working context (path-only compaction projection, history prefetch, never a matching source)
│   ├── file-observation.ts   # File-observation normalization for read/write/edit/apply_patch/lsp (live events; history parts feed path-only Working context)
│   ├── rule-delivery.ts      # Durable/transient delivery, Hook queues, and identity ledger
│   ├── rule-delivery-codec.ts # Delivery identifiers, formats, history decoding, and transient presence facts
│   ├── rule-delivery-history.ts # Raw history port for delivery decoding
│   ├── runtime-context.ts    # Context-building helpers (match context, project detection)
│   ├── runtime-chat.ts       # Chat message handling and text extraction
│   ├── rule-discovery.ts     # Rule file scanning, discovery, and per-session snapshots
│   ├── rule-metadata.ts      # YAML frontmatter parsing
│   ├── rule-filter.ts        # Rule matching against context, lifetime classification (globs, fileContains, keywords, tools, runtime)
│   ├── message-paths.ts      # Legacy path-extraction compatibility facade
│   ├── message-context.ts    # User prompt extraction from message parts
│   ├── session-store.ts      # Per-session state management
│   ├── project-fingerprint.ts # Project type detection (Node.js, Python, etc.)
│   ├── mcp-tools.ts          # MCP tool ID extraction
│   ├── git-branch.ts         # Git branch detection
│   ├── matched-rules-state.ts # Persists Matched-rule state for TUI
│   ├── debug.ts              # Debug logging utilities
│   ├── utils.ts              # Re-export facade for backwards compatibility
│   ├── test-fixtures.ts      # Shared test fixtures and builders
│   └── *.test.ts             # Unit/integration tests in src
├── tui/
│   ├── index.tsx             # TUI entrypoint, exports { id, tui }
│   ├── slots/
│   │   └── sidebar-content.tsx # Sidebar widget component
│   ├── data/
│   │   ├── rules.ts          # Rule discovery + formatting for sidebar
│   │   └── rules.test.ts     # Data layer tests
│   └── types/
│       └── opencode-plugin-tui.d.ts  # Vendored type shim
├── docs/
│   └── rules.md              # Detailed usage documentation
├── openspec/                 # Project specifications and proposals
└── dist/                     # Compiled JavaScript output
```

#### Key Module Responsibilities

The following highlights the primary runtime modules:

- **runtime.ts** - Orchestrates hooks (`tool.execute.before`, `chat.message`, `experimental.chat.*`)
- **rule-delivery.ts** - Owns durable/transient delivery, matched Hook queues, history reconstruction, and the identity ledger
- **rule-delivery-codec.ts** - Encodes durable/transient delivery and decodes durable history facts plus transient presence facts
- **rule-delivery-history.ts** - Defines the raw host-history port used by delivery decoding
- **runtime-context.ts** - Builds `RuleMatchContext` from session state and environment
- **runtime-chat.ts** - Extracts text from chat message parts for keyword matching
- **rule-discovery.ts** - Recursively scans directories for `.md`/`.mdc` rule files
- **rule-metadata.ts** - Parses YAML frontmatter into typed `RuleMetadata`
- **rule-filter.ts** - Matches rules against context (file-observation family: globs + fileContains, keywords, tools, runtime filters) and classifies each match as session-durable or ephemeral
- **message-paths.ts** - Compatibility facade for the legacy path-extraction API; runtime matching uses normalized File observations
- **message-context.ts** - Extracts user prompt text, slash commands, and session IDs from message parts
- **session-store.ts** - Manages per-session state with LRU eviction
- **project-fingerprint.ts** - Detects project type from marker files (e.g., `package.json`)
- **mcp-tools.ts** - Maps connected MCP clients to tool IDs for `tools` condition matching
- **git-branch.ts** - Resolves current git branch for `branch` condition matching
- **matched-rules-state.ts** - Persists Matched-rule state to `~/.opencode/state/opencode-rules/{sessionId}.json` for TUI consumption (atomic writes, per-session queuing)
- **utils.ts** - Thin facade re-exporting from decomposed modules

### TUI Sidebar

The plugin registers a `sidebar_content` slot in the OpenCode TUI, displaying all discovered rules (global and project-local) with their active state and metadata.

**Requirements:** `@opencode-ai/plugin` ^1.3.7 with TUI support.

**What it shows:**

- Collapsible "Project" and "Global" sections grouping rules by scope
- Active/inactive status indicators (green bullet for active, muted for inactive) based on persisted state from the current session
- Condition summary for conditional rules ("always active" for unconditional ones)
- Expandable detail panel with all metadata fields (globs, fileContains, keywords, tools, model, agent, command, project, branch, os, ci, match)
- Loading, error, and empty states

**Behavior:**

- Active rules are sorted to the top within each section
- Subscribes to `message.updated` and `session.status` events for real-time refresh (150ms debounce, filtered by session ID)
- Active state is read from `~/.opencode/state/opencode-rules/{sessionId}.json`, written by the server plugin after each rule evaluation

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

This plugin uses OpenCode's hook system for incremental, stateful rule delivery:

### Hook-Based Approach

1. **`tool.execute.before`** - Reactive hook evaluation
   - Fires before each tool runs
   - Evaluates `PreToolUse` hooks: rules with `block: true` can prevent execution
   - Queues matched PreToolUse hook content for delivery on the next user message (ordinary rule matching does not run here)
   - Records no File observations: a failed or blocked execution must never activate file-family rules

2. **`tool.execute.after`** - File observation capture, admission, and post-execution guidance
   - Fires after each successful tool completes (failed executions never reach this hook)
   - Normalizes Read, Write, Edit, Apply Patch, and LSP events into File observations (path plus content) — the sole source for `globs` and `fileContains`
   - Immediately evaluates file-observation-family rules (`globs`, `fileContains`, or both) against fresh observations; a durable match is admitted synchronously and persisted through a `noReply` `session.prompt` call (earliest dispatch), with retry on the next dispatch if persistence fails
   - Evaluates `PostToolUse` hooks for reactive rule triggering
   - Queues corrective rule content for delivery on the next turn; hook blocking
     and `run` side effects are unchanged
   - Hook text uses the same single-event framing as ordinary rules. Durable-owner hooks join the next durable `chat.message` delivery; ephemeral-owner hooks join the next transient `experimental.chat.messages.transform` delivery and are never persisted

3. **`chat.message`** - User prompt capture and synthetic-part rule delivery
   - Fires as each user message arrives
   - Extracts and stores the latest user prompt text
   - Enables keyword-based rule matching across the conversation flow
   - Receives full runtime match context: model, agent, command, project type, git branch, OS, and CI environment
   - Evaluates the session rule snapshot and filters based on:
     - Normalized file observations from session state (`globs`, `fileContains`)
     - Latest user prompt (`keywords`)
     - Available tool IDs (`tools`)
     - Runtime environment (model, agent, command, project, branch, OS, CI)
   - Command is inferred from the leading slash token (first token) of the latest user prompt
   - Appends all newly matched **session-durable** rules and durable hook guidance to the user message as one framed synthetic text part (id prefix `prt_rules_`) before opencode persists it; ephemeral matches (agent, model, branch, tools) are never written here
   - Synthetic parts are hidden in the TUI but included in provider requests, keeping the system prompt byte-stable across requests for provider prompt caching
   - Path-derived identity keys ensure durable rules already present in session history are not re-appended when content changes or a session resumes
   - `message.removed` events invalidate the delivery ledger so rules attached to canceled or reverted messages are retried on the replacement message
   - Rule content and metadata are snapshotted per session at first evaluation; in-process file edits do not change an existing session's delivery

4. **`experimental.chat.messages.transform`** - History seeding, ephemeral rule delivery, and transient hook delivery
   - Fires before each model request; history seeding runs only on the first
     call (gated by seededFromHistory), while transient rule/hook delivery runs
     on every request
   - Seeds session state from full message history if needed
   - Rebuilds the delivery dedup ledger from request history when a session is resumed
   - Evaluates the session snapshot against the current request and appends
     matching **ephemeral** rules (agent, model, branch, tools) as transient
     synthetic user messages (`prt_rule_ephemeral_`) — request-scoped only,
     never persisted, so switching agent or model swaps the applicable rules
   - Delivers all queued hook content together with matching ephemeral rules in the same framed transient synthetic user message (`prt_rule_ephemeral_`) appended to the very next model request - never persisted

5. **`experimental.session.compacting`** - Compaction context preservation
   - Fires when a session is compacted (summarized)
   - Injects Working-context paths into the compaction context
   - Rebuilds the durable delivery ledger from post-compaction request history so rules removed by compaction are re-appended, while rules still present are not duplicated

### Experimental API Notice

This plugin depends on experimental OpenCode APIs:

- `experimental.chat.messages.transform` (history seeding, transient rule and hook delivery)
- `experimental.session.compacting` (compaction context)

It also uses the stable `chat.message` hook for synthetic-part rule delivery.

These APIs may change in future OpenCode versions. Check OpenCode release notes when upgrading.

## Debug Logging

To enable debug logging, set the `OPENCODE_RULES_DEBUG` environment variable:

```bash
OPENCODE_RULES_DEBUG=1 opencode
```

This will log information about:

- Rule discovery (files found)
- Cache hits/misses
- Rule matching (which rules are included/skipped)
- Available tool IDs (useful for writing `tools` conditions)

All plugin console output, including warnings and TUI rule-load errors, is
suppressed unless `OPENCODE_RULES_DEBUG` is set. The value is captured when
the plugin module loads, so set it before launching OpenCode.

## Troubleshooting

### Rules Not Appearing

1. Verify directories exist: `~/.config/opencode/rules/` and/or `.opencode/rules/`
2. Check file extensions are `.md` or `.mdc`
3. Ensure files with metadata have properly formatted YAML
4. Enable debug logging (`OPENCODE_RULES_DEBUG=1`) to see which rules are being matched

### Common Issues

- **Missing directories**: Plugin gracefully handles missing directories
- **Invalid YAML**: Metadata parsing errors are logged when debug logging is enabled but don't crash the plugin
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

### Publishing a Beta Release

Beta releases are published from the `dev` branch. To cut a beta:

1. Ensure all checks pass on `dev`
2. Bump the version in `package.json` using a semver prerelease suffix (e.g., `0.7.0-beta.1`)
3. Commit: `chore: bump to 0.7.0-beta.1`
4. Tag: `git tag v0.7.0-beta.1`
5. Push: `git push origin dev --tags`

The `release-beta.yml` workflow publishes to npm with `--tag beta` and creates a prerelease GitHub Release.

### Publishing a Stable Release

Stable releases are published from `main`. Same process as beta but use a plain semver version (e.g., `0.7.0`). The `release.yml` workflow publishes to npm with the `latest` dist-tag.

## See Also

- [OpenCode Documentation](https://docs.opencode.ai/)
