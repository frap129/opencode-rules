# Design: add-rule-filter-framework

## Summary

Introduce a unified filter framework for rule frontmatter that extends current conditional matching (`globs`, `keywords`, `tools`) with runtime/environment dimensions and an explicit combinator:

- New dimensions: `model`, `agent`, `command`, `project`, `branch`, `os`, `ci`
- New combinator: `match` with values `any` (default) and `all`

The implementation remains backward compatible by preserving current OR behavior when `match` is omitted.

## Goals

- Enable precise rule targeting by model and agent role.
- Support repository/environment-aware targeting without requiring touched-file context.
- Keep matching deterministic and cheap at injection time.
- Preserve behavior for existing rules.

## Non-Goals

- No arbitrary expression language (`when` DSL) in this change.
- No user-configurable combinator precedence beyond `any|all`.
- No external network calls for project/environment detection.

## Filter Context Model

Rule evaluation uses a canonical context object assembled in runtime:

- Existing:
  - `contextPaths: string[]`
  - `userPrompt?: string`
  - `availableToolIDs?: string[]`
- New:
  - `modelID?: string`
  - `agentType?: string`
  - `command?: string` (slash token like `/plan` when present)
  - `projectTags?: string[]`
  - `gitBranch?: string`
  - `os?: "linux" | "darwin" | "windows" | string`
  - `ci?: boolean`

### Data sources

- `modelID`, `agentType`: read from hook input metadata when available.
- `command`: derived from latest user prompt by extracting the first slash-prefixed token.
- `projectTags`: derived from repository-root fingerprint files (deterministic marker mapping).
- `gitBranch`: best-effort from local git state.
- `os`, `ci`: process/runtime environment.

If a value cannot be derived, it remains undefined and matching proceeds with documented fallback behavior.

## Frontmatter Schema

Supported conditional keys become:

- Existing arrays: `globs`, `keywords`, `tools`
- New arrays: `model`, `agent`, `command`, `project`, `branch`, `os`
- New scalar: `ci` (boolean)
- New scalar: `match` (`any|all`)

YAML inline and block list syntax are both valid. Unrecognized keys remain ignored.

## Matching Semantics

For each declared dimension, compute a dimension match boolean.

- String-array dimensions match when **any** value in the rule matches current context value(s).
- `branch` supports glob-style pattern matching for branch names.
- `ci` matches by boolean equality.

Combinator:

- `match: any` (default): rule applies when at least one declared dimension matches.
- `match: all`: rule applies only when every declared dimension matches.

Rules with no conditional keys remain unconditional.

## Project Fingerprinting

`project` uses deterministic tags from repository root markers (examples):

- `package.json` -> `node`
- `pyproject.toml` -> `python`
- `go.mod` -> `go`
- `Cargo.toml` -> `rust`
- `pnpm-workspace.yaml` or `turbo.json` -> `monorepo`
- browser extension markers (e.g., extension manifest) -> `browser-extension`

Multiple tags may be emitted. No marker yields `[]` (no synthetic fallback tag).

## Backward Compatibility

- Existing rules (`globs`/`keywords`/`tools`) continue unchanged.
- Omitting `match` preserves current OR behavior (`any`).
- Existing tests for legacy behavior remain valid and act as regression protection.

## Validation Strategy

- Parser tests for new keys and YAML syntaxes.
- Matcher tests for each new dimension.
- Combinator tests for `any` vs `all`.
- Integration tests combining legacy and new dimensions.
- Runtime tests for best-effort context derivation and graceful fallback when values are unavailable.
