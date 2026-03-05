# Proposal: add-rule-filter-framework

## Why

Conditional rule matching is currently limited to `globs`, `keywords`, and `tools`, with fixed OR behavior across those dimensions. That works for file- and prompt-driven routing, but it cannot target rules by runtime context (model/agent/command), repository identity (project type), or execution environment (branch/OS/CI).

Users need a complete filter framework so rules can be applied precisely without creating many duplicated rule files.

## What Changes

- Expand rule frontmatter with additional conditional fields:
  - `model`
  - `agent`
  - `command`
  - `project`
  - `branch`
  - `os`
  - `ci`
- Add `match` combinator with values:
  - `any` (default; backward-compatible)
  - `all` (all declared dimensions must match)
- Keep existing fields (`globs`, `keywords`, `tools`) and include them in the same framework.
- Define a canonical filter evaluation context assembled at rule-injection time (session context + runtime/environment context).
- Add deterministic repository fingerprinting for `project` tags.
- Define matching semantics for new string-based filters and document fallback behavior when context data is unavailable.

## Impact

- Affected spec: `rule-discovery`
- Affected code:
  - `src/utils.ts` (frontmatter parsing + rule matching)
  - `src/runtime.ts` (filter context assembly)
  - `src/session-store.ts` (session context shape additions as needed)
  - `src/index.test.ts` and related tests (new filter and matching scenarios)
- Backward compatibility: Existing rules without new fields continue to behave exactly as today.
- Risk: Medium (cross-cutting matching logic and context assembly), mitigated by explicit parser/matcher/runtime regression tests.
