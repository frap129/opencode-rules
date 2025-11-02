# OpenCode Rules

This document explains how to use OpenCode Rules to inject custom instructions into the agent's system prompt.

## Rule Files

Rules are defined in Markdown files (`.md` or `.mdc`). These files can be located in two places:

- **Global Rules:** `~/.config/opencode/rules/`
- **Project Rules:** `.opencode/rules/` in the root of your project.

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
