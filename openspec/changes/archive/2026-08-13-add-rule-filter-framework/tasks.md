# Tasks: add-rule-filter-framework

## 1. Metadata and matching foundation

- [ ] 1.1 Extend rule metadata parsing to support `model`, `agent`, `command`, `project`, `branch`, `os`, `ci`, and `match`
- [ ] 1.2 Define a canonical filter context type used by rule evaluation
- [ ] 1.3 Implement `match: any|all` combinator behavior with backward-compatible default to `any`
- [ ] 1.4 Preserve existing `globs`, `keywords`, and `tools` behavior under `match: any`

## 2. Runtime context plumbing

- [ ] 2.1 Extend runtime rule evaluation inputs to include model, agent, command, project tags, branch, OS, and CI
- [ ] 2.2 Extract `command` from the latest slash-style user prompt token when present
- [ ] 2.3 Add best-effort branch detection and safe fallback when git metadata is unavailable
- [ ] 2.4 Add deterministic project fingerprinting from repository root markers

## 3. Test coverage

- [ ] 3.1 Add parser tests for new fields and YAML list styles (inline + block)
- [ ] 3.2 Add matcher tests for each new dimension and `match: any|all`
- [ ] 3.3 Add integration tests for mixed legacy + new filters
- [ ] 3.4 Add regression tests proving legacy rules still behave identically when `match` is omitted

## 4. Validation

- [ ] 4.1 Run: `bun run test`
- [ ] 4.2 Run: `bun run lint`
- [ ] 4.3 Run: `bun run typecheck`
- [ ] 4.4 Run: `openspec validate add-rule-filter-framework --strict`
