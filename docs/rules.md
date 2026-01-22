# OpenCode Rules

This document explains how to use OpenCode Rules to inject custom instructions into the agent's system prompt.

## Rule Files

Rules are defined in Markdown files (`.md` or `.mdc`). These files can be located in two places:

- **Global Rules:** `~/.config/opencode/rules/`
- **Project Rules:** `.opencode/rules/` in the root of your project.

Both directories are scanned **recursively**, so you can organize your rules into subdirectories.

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

You can define conditional rules in both `.md` and `.mdc` files. This is done by adding a YAML frontmatter to the file with a `globs` key.

The `globs` key should contain a list of glob patterns. The rule will only be applied if the file being processed matches one of the glob patterns.

### Example

Here is an example of a conditional rule that only applies to TypeScript files in the `src/components` directory:

```markdown
---
globs:
  - 'src/components/**/*.ts'
---

This is a rule for TypeScript components.
```

If no `globs` are specified, the rule will be applied to all files.
