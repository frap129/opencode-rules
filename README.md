# OpenCode Rules Plugin

A powerful OpenCode plugin that discovers and injects markdown rule files into system prompts, enabling flexible AI agent behavior customization.

## Features

- **Dual-format support**: Load rules from both `.md` and `.mdc` files
- **Metadata-driven filtering**: Apply rules conditionally based on file paths using glob patterns
- **Global and project-level rules**: Define rules at both system and project scopes
- **Zero-configuration**: Works out of the box with XDG Base Directory specification
- **Backward compatible**: Existing `.md` rules continue to work as expected

## Installation

```bash
npm install opencode-rules
```

## Configuration

### Global Rules Directory

Rules are discovered from the following locations:

1. **Global rules**: `$XDG_CONFIG_HOME/opencode/rules/` (typically `~/.config/opencode/rules/`)
2. **Project rules**: `.opencode/rules/` (in your project directory)

Create these directories and add your rule files to enable automatic rule injection.

## Usage

### Basic Rule File (`.md`)

Create a simple markdown rule file that applies unconditionally:

```markdown
# My Coding Rule

Always use meaningful variable names.
Follow the project's code style guide.
```

Save this as `~/.config/opencode/rules/naming-convention.md` and it will be automatically injected into all AI agent prompts.

### Rule File with Metadata (`.mdc`)

For more control, use the `.mdc` format which supports metadata-driven conditional rule application:

```markdown
---
globs:
  - 'src/components/**/*.ts'
---

# TypeScript Component Rules

- Always use TypeScript strict mode
- Export components as named exports
- Include PropTypes for React components
```

Save this as `~/.config/opencode/rules/typescript-components.mdc`.

This rule will only be applied when the AI agent is processing files matching the glob pattern `src/components/**/*.ts`.

## Metadata Format

The metadata section uses YAML front matter enclosed in `---` delimiters.

### Supported Fields

#### `globs` (optional)

An array of glob patterns to match file paths for conditional rule application.

```yaml
---
globs:
  - 'src/**/*.ts'
  - 'lib/**/*.js'
  - '*.test.ts'
---
```

When `globs` is specified:

- The rule is only applied to files matching at least one glob pattern
- Glob patterns use standard minimatch syntax
- If no `globs` are specified, the rule applies unconditionally (backward compatible)

## File Format Specifications

### `.md` Files

Standard Markdown files that are always applied unconditionally:

```
# Rule Title

Rule content and instructions for AI agents.
```

**Behavior**: Always applied when discovered.

### `.mdc` Files

Markdown with optional metadata for conditional application:

```
---
globs:
  - "pattern1/**/*.ext"
  - "pattern2/**/*.ext"
---

# Rule Title

Rule content and instructions for AI agents.
```

**Behavior**:

- If metadata with `globs` is present: Applied only to matching files
- If no metadata is present: Applied unconditionally (same as `.md`)

## Examples

### Example 1: Universal Code Style Rule

File: `~/.config/opencode/rules/code-style.md`

```markdown
# Code Style Guidelines

1. Use 2-space indentation
2. Maximum line length of 100 characters
3. Use single quotes for strings (JavaScript)
4. Add JSDoc comments for all functions
```

This rule applies to all files in all projects.

### Example 2: TypeScript-Only Rule

File: `~/.config/opencode/rules/typescript.mdc`

```markdown
---
globs:
  - '**/*.ts'
  - '**/*.tsx'
---

# TypeScript Best Practices

- Always use `const` and `let`, avoid `var`
- Use interfaces for object types
- Use type annotations for function parameters
- Avoid `any` type without justification
```

This rule only applies when processing TypeScript files.

### Example 3: React Component Rule

File: `.opencode/rules/react-components.mdc`

```markdown
---
globs:
  - 'src/components/**/*.tsx'
---

# React Component Guidelines

- Use functional components with hooks
- Components should be in their own directory with index.ts
- Include Storybook stories for UI components
- Use React.memo for expensive components
```

This project-level rule applies only to React components in the src/components directory.

### Example 4: Multiple Patterns

File: `~/.config/opencode/rules/testing.mdc`

```markdown
---
globs:
  - '**/*.test.ts'
  - '**/*.test.tsx'
  - '**/*.spec.ts'
---

# Testing Guidelines

- Use descriptive test names
- Follow Arrange-Act-Assert pattern
- Keep tests focused and small
- Avoid test interdependencies
```

This rule applies to all test files across your projects.

## Glob Pattern Matching

The plugin uses the `minimatch` library for glob pattern matching. Patterns support:

- `*` - matches any character except path separators
- `**` - matches zero or more directories
- `?` - matches exactly one character
- `[...]` - character ranges
- `{a,b,c}` - alternatives

### Common Patterns

| Pattern                       | Matches                                         |
| ----------------------------- | ----------------------------------------------- |
| `src/**/*.ts`                 | All TypeScript files in src and subdirectories  |
| `**/*.test.ts`                | All test files at any depth                     |
| `src/components/**/*.tsx`     | React components in components directory        |
| `*.json`                      | JSON files in root directory only               |
| `lib/{utils,helpers}/**/*.js` | JavaScript files in specific lib subdirectories |

## API Reference

### `parseRuleMetadata(content: string): RuleMetadata \| undefined`

Extracts metadata from rule file content.

```typescript
const metadata = parseRuleMetadata(ruleContent);
if (metadata?.globs) {
  console.log('Rule applies to:', metadata.globs);
}
```

### `fileMatchesGlobs(filePath: string, globs: string[]): boolean`

Checks if a file path matches any glob patterns.

```typescript
const matches = fileMatchesGlobs('src/app.ts', ['src/**/*.ts', 'lib/**/*.js']);
```

### `discoverRuleFiles(projectDir?: string): Promise<string[]>`

Discovers all rule files from global and optional project directories.

```typescript
const ruleFiles = await discoverRuleFiles('/path/to/project');
```

### `readAndFormatRules(files: string[], contextFilePath?: string): Promise<string>`

Reads rule files and formats them for system prompt injection, optionally filtering by context file.

```typescript
const formatted = await readAndFormatRules(
  ruleFiles,
  'src/components/button.tsx'
);
```

## How It Works

1. **Discovery Phase**: The plugin scans `$XDG_CONFIG_HOME/opencode/rules/` and `.opencode/rules/` directories for `.md` and `.mdc` files
2. **Parsing Phase**: For each discovered file, metadata (if present) is extracted from YAML front matter
3. **Filtering Phase**: If a context file path is provided, rules are filtered based on glob patterns
4. **Injection Phase**: Formatted rules are injected as a system prompt suffix to AI agents

## Backward Compatibility

- Existing `.md` rule files continue to work unchanged
- Rules without metadata are always applied (default behavior)
- The plugin gracefully handles missing directories and unreadable files

## Performance Considerations

- Rule discovery is performed once at plugin initialization
- Metadata parsing uses simple regex (no external YAML parser required)
- Glob matching is optimized through the `minimatch` library
- Large rule files have minimal performance impact due to async file reading

## Troubleshooting

### Rules not appearing in prompts

1. Check that rule files exist in the correct directories:
   - Global: `~/.config/opencode/rules/` or `$XDG_CONFIG_HOME/opencode/rules/`
   - Project: `.opencode/rules/`

2. Verify file extensions are `.md` or `.mdc` (not `.txt`, `.markdown`, etc.)

3. For `.mdc` files with metadata, ensure glob patterns match your file paths

4. Check that metadata is properly formatted with `---` delimiters

### Conditional rules not applying

1. Verify glob patterns use correct minimatch syntax
2. Test patterns using the `fileMatchesGlobs()` function
3. Ensure file paths are relative to the project root
4. Check that `globs` is a properly formatted YAML array

## Testing

The plugin includes comprehensive test coverage:

```bash
npm run test       # Run tests in watch mode
npm run test:run   # Run tests once
```

Tests cover:

- Metadata parsing from various formats
- File discovery in global and project directories
- Conditional rule filtering
- Rule formatting and injection
- Error handling and edge cases

## Contributing

Contributions are welcome! Please ensure:

1. All tests pass: `npm run test:run`
2. Code is formatted: `npm run format`
3. No linting errors: `npm run lint`
4. New features include tests

## License

MIT

## See Also

- [OpenCode Documentation](https://docs.opencode.ai/)
- [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html)
- [Minimatch Patterns](https://github.com/isaacs/minimatch)
