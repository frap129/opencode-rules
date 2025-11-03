# OpenCode Rules Plugin

A lightweight OpenCode plugin that discovers and injects markdown rule files into AI agent system prompts, enabling flexible behavior customization without per-project configuration.

## Overview

OpenCode Rules automatically loads rule files from standard directories and integrates them into AI agent prompts, allowing you to:

- Define global coding standards that apply across all projects
- Create project-specific rules for team collaboration
- Apply conditional rules based on file patterns
- Maintain zero-configuration workflow with sensible defaults

## Features

- **Dual-format support**: Load rules from both `.md` and `.mdc` files
- **Conditional rules**: Apply rules based on file paths using glob patterns
- **Global and project-level rules**: Define rules at both system and project scopes
- **Session-aware**: Rules persist across messages and survive session compactions
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

Rules are automatically discovered from these directories:

1. **Global rules**: `$XDG_CONFIG_HOME/opencode/rules/` (typically `~/.config/opencode/rules/`)
2. **Project rules**: `.opencode/rules/` (in your project root)

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
  - '*.test.ts'
---
```

### Supported Fields

- `globs` (optional): Array of glob patterns for conditional application
  - If specified: Rule applies only to files matching at least one pattern
  - If omitted: Rule applies unconditionally

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

## How It Works

1. **Discovery**: Scan global and project directories for `.md` and `.mdc` files
2. **Parsing**: Extract metadata from files with YAML front matter
3. **Filtering**: Apply conditional rules based on file patterns
4. **Silent Messaging**: Send rules as silent messages (no AI response) on session events
5. **Session Tracking**: Track which sessions have received rules to avoid duplication
6. **Compaction Handling**: Automatically re-send rules when sessions are compacted

### Silent Message Pattern

The plugin uses OpenCode's `noReply` message pattern to inject rules without triggering AI responses:

```typescript
await client.session.prompt({
  path: { id: sessionID },
  body: {
    noReply: true, // Silent message - no AI response
    parts: [{ type: 'text', text: rules }],
  },
});
```

This ensures rules are added to the conversation context cleanly and efficiently.

## Session Compaction Support

When OpenCode compacts a session (summarizes conversation history to save context), the rules are automatically re-sent to ensure they remain in the AI's context.

### How It Works

1. Rules are sent as silent messages when a new session is created
2. The plugin tracks which sessions have received rules
3. When a session is compacted, rules are immediately re-sent
4. This ensures rules survive context compression

### Event-Driven Architecture

The plugin listens for two key events:

- **`session.created`**: Sends rules when a new session starts
- **`session.compacted`**: Re-sends rules after history compression

This behavior is transparent and requires no configuration - your rules will always be available to the AI agent, even in long conversations.

## Performance

- Rule discovery performed once at plugin initialization
- Async file operations to prevent blocking
- Optimized glob matching with `minimatch`
- Minimal memory footprint with efficient file reading
- Session tracking uses memory-efficient Set data structure

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
