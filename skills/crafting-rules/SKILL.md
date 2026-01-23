---
name: crafting-rules
description: Use when creating or modifying OpenCode rules (.md/.mdc files) that customize agent behavior. Helps extract patterns from conversation history, analyze project conventions (AGENTS.md, linters, package.json), and draft well-formatted rules with appropriate globs/keywords. Trigger when user wants to create a rule, codify repeated instructions, persist guidance across sessions, or customize agent behavior for specific files or topics.
---

# Crafting Rules

Rules are markdown files injected into the system prompt to guide agent behavior.

## Rule Format

```md
---
globs:
  - '**/*.ts'
keywords:
  - 'vitest'
---

# Rule Title

- Write rules as concrete, actionable instructions.
```

## Field Reference

| Field      | Type       | Purpose                                               |
| ---------- | ---------- | ----------------------------------------------------- |
| `globs`    | `string[]` | Apply when any file in context matches a pattern      |
| `keywords` | `string[]` | Apply when the user's latest prompt matches a keyword |

- Both fields are optional; no frontmatter means the rule always applies.
- If both `globs` and `keywords` are present, matching is OR (either triggers).

## Matching Strategy

- Use `globs` when the rule is about code in specific files/directories.
- Use `keywords` when the rule is about a topic that may not include files.
- Use both when either condition should trigger.
- Use neither for global standards (tone, structure, safety, commit conventions).

Important constraints:

- Keyword matching is case-insensitive word-boundary _prefix_ matching (e.g., `test` matches `tests` and `testing`).
- You cannot express `globs AND keywords`; if you need that behavior, split into multiple rules.

## Storage Location

- `~/.config/opencode/rules/`: personal preferences you want across projects.
- `.opencode/rules/`: project/team conventions and repo-specific behavior.

## Extracting Rules from Patterns

Signals a pattern should become a rule:

- Explicit: "always do X", "never do Y", "remember to...", "from now on..."
- Corrections: the user fixes the same agent behavior more than once
- Preferences: consistent style/process guidance (tests, commits, PRs, error handling)
- Frustration indicators: "I told you before", "again"

Analysis questions:

- Is this recurring, or a one-off for the current task?
- Does this apply to specific files, or all work?
- Is there an existing rule/config that already encodes this (AGENTS.md, lint config, Prettier, etc.)?
- Would this conflict with project conventions?

Workflow:

1. Identify the behavioral delta (what should change?).
2. Determine scope (globs, keywords, or always-on).
3. Check existing rules/configs for overlap/conflict.
4. Draft the minimal rule (one concept per rule when practical).
5. Choose location (global vs project).

Conversation extraction examples:

- User: "Use early returns instead of nested if/else" -> always-on code style rule.
- User: "In unit tests, always use describe/it blocks" -> prefer glob-scoped rule (e.g., `**/*.{test,spec}.*`, `**/__tests__/**`); if prompt-scoped, use allowlisted keywords like `unit test`, `vitest`, `jest` (avoid `test`/`testing`).
- User repeatedly fixes import ordering -> glob-scoped rule for the relevant languages/files.

## Keyword Selection Guidelines

How matching works (important):

- Keywords are matched with case-insensitive word-boundary prefix matching, so short/generic keywords tend to over-match.

Denylist (avoid by default):

- Generic nouns: `code`, `file`, `project`, `repo`, `bug`, `issue`, `change`
- Common verbs: `add`, `update`, `remove`, `fix`, `make`, `create`, `implement`
- Over-broad topic nouns: `testing`, `performance`, `security`, `deployment`, `database`, `api`
- Single-token abbreviations: `ci`, `cd`, `db`, `ui`, `ux`

Allowlist (prefer by default):

- Tool/framework names: `vitest`, `jest`, `pytest`, `playwright`, `cypress`, `eslint`, `prettier`, `typescript`, `terraform`, `kubernetes`
- Compound phrases: `unit test`, `integration test`, `snapshot test`, `lint rule`, `error boundary`, `api endpoint`, `rest api`
- High-intent engineering verbs: `refactor`, `rollback`, `migrate`, `deprecate`

If you feel tempted to use a denylisted keyword:

- Prefer globs (file-scoped) instead.
- Or replace it with a compound phrase / tool name that captures intent.

Keyword audit checklist:

- Would this keyword appear in prompts where the rule should NOT apply?
- Is it likely to appear as part of another word due to prefix matching?
- Can you scope via globs instead?

## Writing Guidelines

- Use imperative voice: "Do X", "Prefer Y", "Avoid Z".
- Make rules executable: instructions the agent can follow.
- Stay minimal: avoid restating generic best practices.
- Prefer examples over prose when a pattern is subtle.

## Examples

Glob-based: TypeScript conventions

```md
---
globs:
  - '**/*.ts'
  - '**/*.tsx'
---

# TypeScript

- Prefer `type` over `interface` unless you need declaration merging.
- Avoid `any`; use `unknown` and narrow.
```

Keyword-based: unit test guidance (allowlisted terms)

```md
---
keywords:
  - 'unit test'
  - 'integration test'
  - 'vitest'
  - 'jest'
---

# Unit Tests

- Follow Arrange-Act-Assert.
- Name tests: `it('should <expected> when <condition>')`.
```

Unconditional: always-on standards

```md
# Code Style

- Prefer early returns over deep nesting.
- Extract magic numbers to named constants.
```

Combined: deployment safety (OR logic)

```md
---
globs:
  - '**/deploy/**'
  - '**/*.tf'
keywords:
  - 'terraform'
  - 'kubernetes'
  - 'production'
  - 'rollback'
---

# Deployment

- Never hardcode secrets; use environment variables or a secrets manager.
- Include rollback steps in any production change plan.
```
