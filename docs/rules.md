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
