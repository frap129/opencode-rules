# OpenCode Rules Plugin

A lightweight OpenCode plugin that discovers and injects markdown rule files into AI agent system prompts, enabling flexible behavior customization without per-project configuration.

## Overview

OpenCode Rules automatically loads rule files from standard directories and integrates them into AI agent prompts, allowing you to:

- Define global coding standards that apply across all projects
- Create project-specific rules for team collaboration
- Apply conditional rules based on file patterns or prompt keywords
- Maintain zero-configuration workflow with sensible defaults

## Features

- **Dual-format support**: Load rules from both `.md` and `.mdc` files
- **Conditional rules**: Apply rules based on file paths using glob patterns or prompt keywords
- **Keyword matching**: Apply rules when the user's prompt contains specific keywords
- **Global and project-level rules**: Define rules at both system and project scopes
- **Context-aware injection**: Rules filtered by extracted file paths and user prompts
- **Zero-configuration**: Works out of the box with XDG Base Directory specification
- **TypeScript-first**: Built with TypeScript for type safety and developer experience
- **Performance optimized**: Efficient file discovery and minimal startup overhead

## Quick Start

### Installation

Add the plugin to your opoencode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-rules"]
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
globs:
  - 'src/**/*.ts'
  - 'lib/**/*.js'
keywords:
  - 'refactoring'
  - 'cleanup'
---
```

### Supported Fields

- `globs` (optional): Array of glob patterns for file-based matching
  - Rule applies when any file in context matches a pattern
- `keywords` (optional): Array of keywords for prompt-based matching
  - Rule applies when the user's prompt contains any keyword
  - Case-insensitive, word-boundary matching (e.g., "test" matches "testing")
  - Does NOT match mid-word (e.g., "test" does NOT match "contest")

### Matching Behavior

- **No metadata**: Rule applies unconditionally (always included)
- **Only globs**: Rule applies when any context file matches
- **Only keywords**: Rule applies when the user's prompt contains any keyword
- **Both globs and keywords**: Rule applies when EITHER condition matches (OR logic)

## Glob Pattern Reference

The plugin uses `minimatch` for pattern matching:

| Pattern                       | Matches                                         |
| ----------------------------- | ----------------------------------------------- |
| `src/**/*.ts`                 | All TypeScript files in src and subdirectories  |
| `**/*.test.ts`                | All test files at any depth                     |
| `src/components/**/*.tsx`     | React components in components directory        |
| `*.json`                      | JSON files in root directory only               |
| `lib/{utils,helpers}/**/*.js` | JavaScript files in specific lib subdirectories |

## Development

### Project Structure

```
opencode-rules/
├── src/
│   ├── index.ts          # Main plugin entry point
│   ├── utils.ts          # File discovery and processing utilities
│   └── index.test.ts     # Test suite
├── docs/
│   └── rules.md          # Detailed usage documentation
├── openspec/             # Project specifications and proposals
└── dist/                 # Compiled JavaScript output
```

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

This plugin uses OpenCode's experimental transform hooks to inject rules into the LLM context:

### Two-Hook Approach

1. **`experimental.chat.messages.transform`** - Fires before each LLM call
   - Extracts file paths from conversation messages (tool calls, text content)
   - Stores paths for conditional rule filtering
   - Does NOT modify messages

2. **`experimental.chat.system.transform`** - Fires after messages.transform
   - Reads discovered rule files
   - Filters conditional rules (`.mdc` with `globs`) against extracted file paths
   - Appends formatted rules to the system prompt

### Benefits Over Previous Approach

- **No session tracking** - Rules are injected fresh on every LLM call
- **No compaction handling** - System prompt is rebuilt automatically
- **Cleaner injection** - Rules in system prompt instead of conversation messages
- **Context-aware filtering** - Conditional rules only apply when relevant files are referenced

### Experimental API Notice

This plugin depends on experimental OpenCode APIs:

- `experimental.chat.messages.transform`
- `experimental.chat.system.transform`

These APIs may change in future OpenCode versions. Check OpenCode release notes when upgrading.

## How It Works

1. **Discovery**: Scan global and project directories for `.md` and `.mdc` files
2. **Parsing**: Extract metadata from files with YAML front matter
3. **Messages Transform**: Extract file paths from message content for context awareness
4. **Filtering**: Apply conditional rules based on extracted file paths
5. **System Transform**: Append filtered rules to the system prompt
6. **Fresh Injection**: Rules are re-evaluated on every LLM call, ensuring always-current context

## Performance

- Rule discovery performed once at plugin initialization
- Async file operations to prevent blocking
- Optimized glob matching with `minimatch`
- Minimal memory footprint with efficient file reading
- Per-call context extraction using WeakMap to prevent memory leaks

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
