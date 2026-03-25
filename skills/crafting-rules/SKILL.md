---
name: crafting-rules
description: Use when creating or modifying OpenCode rules (.md/.mdc files) that customize agent behavior. Trigger when user wants to create a rule, codify repeated instructions, persist guidance across sessions, or scope rules to specific files, prompts, environments, or workflows.
---

# Crafting Rules

## Overview

Rules are markdown files with optional YAML frontmatter, injected into the system prompt to guide agent behavior. Scope them with filters or leave unconditional for global standards.

## Field Reference

| Field      | Type               | Category   | Purpose                                                    |
| ---------- | ------------------ | ---------- | ---------------------------------------------------------- |
| `globs`    | `string[]`         | Legacy     | Apply when any file in context matches a pattern           |
| `keywords` | `string[]`         | Legacy     | Apply when the user's latest prompt matches a keyword      |
| `tools`    | `string[]`         | Legacy     | Apply when any listed tool ID is available                 |
| `model`    | `string[]`         | Runtime    | Match against the current LLM model ID                     |
| `agent`    | `string[]`         | Runtime    | Match against the current agent type (e.g., `programmer`)  |
| `command`  | `string[]`         | Runtime    | Match against the current slash command (e.g., `/plan`)    |
| `project`  | `string[]`         | Runtime    | Match against detected project tags (e.g., `node`, `rust`) |
| `branch`   | `string[]`         | Runtime    | Match against git branch name (supports glob patterns)     |
| `os`       | `string[]`         | Runtime    | Match against OS (`linux`, `darwin`, `win32`)              |
| `ci`       | `boolean`          | Runtime    | Match against CI environment (`true` = in CI)              |
| `match`    | `'any'` \| `'all'` | Combinator | `any` (default): OR logic. `all`: AND logic.               |

- All fields are optional; no frontmatter means the rule always applies.
- With `match: any` (default), the rule applies if ANY declared condition matches.
- With `match: all`, the rule applies only if ALL declared conditions match.
- When a runtime value is unavailable (e.g., no git repo), that dimension is a non-match.

## Rule Format

```md
---
globs:
  - '**/*.ts'
keywords:
  - 'vitest'
model:
  - claude-sonnet-4
agent:
  - programmer
branch:
  - feature/*
match: any
---

# Rule Title

- Write rules as concrete, actionable instructions.
```

## Matching Strategy

- Use `globs` when the rule is about code in specific files/directories.
- Use `keywords` when the rule is about a topic that may not include files.
- Use `tools` when the rule depends on specific MCP tools being available.
- Use runtime filters (`model`, `agent`, `command`, `project`, `branch`, `os`, `ci`) to scope rules to specific environments or workflows.
- Use `match: all` when you need every declared condition to be true (AND logic).
- Use `match: any` (or omit `match`) when any single condition should trigger (OR logic).
- Use no filters for global standards (tone, structure, safety, commit conventions).

Important constraints:

- Keyword matching is case-insensitive word-boundary _prefix_ matching (e.g., `test` matches `tests` and `testing`).
- Branch patterns support globs via minimatch (e.g., `feature/*`, `release/**`).
- Missing runtime context (e.g., no git repo for `branch`) counts as a non-match for that dimension.

## Keyword Selection

Keywords use case-insensitive word-boundary prefix matching — short or generic words over-match.

Denylist: generic nouns (`code`, `file`, `project`, `repo`, `bug`, `issue`, `change`), common verbs (`add`, `update`, `remove`, `fix`, `make`, `create`, `implement`), over-broad topics (`testing`, `performance`, `security`, `deployment`, `database`, `api`), single-token abbreviations (`ci`, `cd`, `db`, `ui`, `ux`).

Allowlist: tool/framework names (`vitest`, `jest`, `pytest`, `playwright`, `cypress`, `eslint`, `prettier`, `typescript`, `terraform`, `kubernetes`), compound phrases (`unit test`, `integration test`, `snapshot test`, `lint rule`, `error boundary`, `api endpoint`, `rest api`), high-intent verbs (`refactor`, `rollback`, `migrate`, `deprecate`).

Audit checklist:

- Would this keyword appear in prompts where the rule should NOT apply?
- Is it likely to appear as part of another word due to prefix matching?
- Can you scope via globs instead?
- Prefer globs (file-scoped) over denylisted keywords.
- Replace generic keywords with compound phrases or tool names that capture intent.

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

## Storage Location

- `~/.config/opencode/rules/`: personal preferences you want across projects.
- `.opencode/rules/`: project/team conventions and repo-specific behavior.

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

Runtime filters with `match: all`: feature branch development

```md
---
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

# Feature Branch Dev

- Create atomic commits with clear messages.
- Run tests before pushing.
```

## Common Mistakes

- **Using denylisted keywords**: `test` fires on nearly every prompt — use `unit test` or globs instead.
- **Forgetting `match: all`**: Two filters with default OR means EITHER triggers — add `match: all` for AND logic.
- **Overloading a single rule**: 6+ dimensions are hard to reason about — split into focused rules.
- **Duplicating lint/formatter config**: Check Prettier/ESLint before adding a style rule.
- **Using `ci` as a keyword**: Prefix-matches `circuit`, `citizen` — use `ci: true` boolean filter instead.
