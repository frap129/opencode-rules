# Repo Notes

## Commands

- Use Aube and install with `aube install --frozen-lockfile`. Run checks in this order: `aube run lint` -> `aubx tsc --noEmit` -> `aube run test:run`.
- There is no `typecheck` script; typecheck with `aubx tsc --noEmit`.
- Run one colocated Vitest file with `aube run test:run src/<name>.test.ts` (or a path under `tui/`). `tsconfig.json` excludes test/spec files, so `tsc` does not typecheck them.
- `demo-synthetic-injection.md` at the repo root is a manual E2E script for verifying synthetic-part rule delivery across turns.
- `docs/silent-message-implementation.md` describes a superseded design; current delivery is synthetic parts via `chat.message`.

## Architecture

- One package, two default plugin exports: server entry `src/index.ts` returns `{ id, server }`; TUI entry `tui/index.tsx` returns `{ id, tui }`. The package root imports built `dist/src/index.js`, and `"./tui"` imports built `dist/tui/index.js` (its types come from `dist/tui/index.d.ts`).
- OpenCode's plugin loader calls every named export as a plugin initializer; any added named export must be callable (see the `__testOnly` pattern in `src/index.ts`).
- Rules are injected as synthetic text parts appended to the user message via the `chat.message` hook, not into the system prompt (system-prompt injection was removed). Content-hash dedup keys (`relativePath:sha256-16(content)`) prevent rules already in history from being re-appended.
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
