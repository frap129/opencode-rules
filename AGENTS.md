# Repo Notes

## Commands

- Use Aube and install with `aube install --frozen-lockfile`. Run checks in this order: `aube run lint` -> `aubx tsc --noEmit` -> `aube run test:run`.
- There is no `typecheck` script; typecheck with `aubx tsc --noEmit`.
- Run one colocated Vitest file with `aube run test:run src/<name>.test.ts` (or a path under `tui/`). `tsconfig.json` excludes test/spec files, so `tsc` does not typecheck them.
- `docs/silent-message-implementation.md` describes a superseded design; current delivery is synthetic parts via `chat.message`.

## Architecture

- One package, two default plugin exports: server entry `src/index.ts` returns `{ id, server }`; TUI entry `tui/index.tsx` returns `{ id, tui }`. The package root imports built `dist/src/index.js`, and `"./tui"` imports built `dist/tui/index.js` (its types come from `dist/tui/index.d.ts`).
- OpenCode's plugin loader calls every named export as a plugin initializer; any added named export must be callable (see the `__testOnly` pattern in `src/index.ts`).
- Each injection event is one `<system-message>` block with one preamble and `<rule name="...">` blocks using frontmatter `name` or the filename stem. Session-durable rules (unconditional, globs, keywords, command, project, os, ci) are injected as one synthetic text part appended to the user message via `chat.message`, not into the system prompt. Ephemeral rules (agent, model, branch, tools) are delivered as one transient synthetic message per matching turn via `experimental.chat.messages.transform` and never persisted. Path-derived identity keys prevent durable rules still present in history from being re-appended after content edits or resume; after compaction the ledger is rebuilt and missing durable rules are re-appended. Hook guidance uses the same framing.
- Depends on experimental OpenCode hooks (`experimental.chat.messages.transform`, `experimental.session.compacting`); re-verify against `@opencode-ai/plugin` when upgrading.
- Per-session matched-rule state is written atomically to `~/.opencode/state/opencode-rules/{sessionID}.json`, which the TUI sidebar reads.

## Gotchas

- ESM with NodeNext resolution: relative imports need `.js` extensions even in `.ts`/`.tsx` source.
- The `"./tui"` package export must point to `./dist/tui/index.js`, not raw `./tui/index.tsx`: OpenCode/Bun does not reliably remap `.js` relative imports when loading raw TSX, while those targets exist only after the TypeScript build.
- OpenCode caches npm plugin specs by their literal specifier; an existing `~/.cache/opencode/packages/opencode-rules@latest` wrapper pins the version resolved when it was created and does not refresh when `latest` changes. Clear that cache or use an explicit new version when validating a release.
- tsconfig is strict-plus (`exactOptionalPropertyTypes`, `noUnusedLocals`/`noUnusedParameters`, `verbatimModuleSyntax`), so type-only imports and unused symbols will fail typecheck even though lint passes.
- `src/utils.ts` is the compatibility re-export facade; add logic to domain modules instead. `src/api-surface.typecheck.ts` enforces intentionally private exports during `tsc`.
- Do not edit generated `dist/`; `tsc` builds it from `src/` and `tui/`.
- This repo dogfoods its own plugin: `.opencode/rules/*.md` are injected into sessions and contain additional scoped guardrails.
- When adding/removing/renaming production modules, update the README "Project Structure" section in the same change (`.opencode/rules/11-readme-and-doc-sync.md`).

## Releases

- Stable publishing triggers on non-alpha/non-beta `v*` tags (the workflow does not verify branch containment). Beta tags must be contained by `dev` and publish with the npm `beta` dist-tag.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `frap129/opencode-rules`, using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root plus `docs/adr/` for decisions. See `docs/agents/domain.md`.
