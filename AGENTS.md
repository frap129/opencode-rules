# Repo Notes

## Commands

- Use Aube and install with `aube install --frozen-lockfile`. Run checks in this order: `aube run lint` -> `aubx tsc --noEmit` -> `aube run test:run`.
- There is no `typecheck` script; typecheck with `aubx tsc --noEmit`.
- Run one colocated Vitest file with `aube run test:run src/<domain>/<name>.test.ts` (or a path under `tui/`). `tsconfig.json` excludes test/spec files, so `tsc` does not typecheck them.
- `docs/silent-message-implementation.md` describes a superseded design; current delivery is durable synthetic messages via `session.synthetic` on the v2 plugin contract.

## Architecture

- One package, two default plugin exports: server entry `src/index.ts` returns the v2 `{ id, setup(ctx) }` contract; TUI entry `tui/index.tsx` returns the v2 CLI-plugin `{ id, setup(ctx) }` contract (slot claims via `ctx.ui.slot`, e.g. `sidebar.content`). The package root imports built `dist/src/index.js`, and `"./tui"` imports built `dist/tui/index.js` (its types come from `dist/tui/index.d.ts`).
- The v2 loader imports ONLY the default export of the server entry; `src/index.ts` must carry no named exports. Test seams live in `src/runtime/create-runtime.ts` (`createRuntime`), consumed by tests via direct import.
- Each injection event is one `<system-message>` block with one preamble and `<rule name="...">` blocks using frontmatter `name` or the filename stem. Session-durable rules (unconditional, globs, fileContains, keywords, command, project, os, ci) are published via `ctx.session.synthetic` from the session `prompt` hook as one persisted synthetic message per turn, not into the system prompt. A durable rule first matched by a live File observation is instead admitted at the earliest applicable dispatch through an awaited `session.prompt({ resume: false })`, with transient fallback and retry when persistence fails. Ephemeral rules (agent, model, branch, tools) are delivered as one transient synthetic message per matching turn by mutating `input.messages` in the session `context` hook and never persisted. Live `tool.execute.after` observations are the sole matching source for globs/fileContains; history rebuilds Working-context paths (compaction projection) and delivery-ledger identity only, never File observations. Path-derived identity keys prevent durable rules still present in history from being re-appended after content edits or resume; message removal invalidates the ledger so reverted delivery is retried, and after compaction the ledger is rebuilt so missing durable rules are re-appended. Hook guidance uses the same framing.
- Depends on v2 plugin hooks (`ctx.tool.hook`, `ctx.session.hook('context'|'prompt')`, `ctx.event.subscribe`) and client surface (`session.context`/`session.prompt`/`session.synthetic`, `mcp.list`); re-verify against `@opencode-ai/plugin@beta` when upgrading. Available built-in tool IDs come from the context hook's tool table (the v1 `tool.ids` RPC is gone); message-removal invalidation keys on `session.revert.*` events (`message.removed` is gone).
- Per-session matched-rule state is written atomically to `~/.opencode/state/opencode-rules/{sessionID}.json`, which the TUI sidebar reads.

## Gotchas

- ESM with NodeNext resolution: relative imports need `.js` extensions even in `.ts`/`.tsx` source.
- The `"./tui"` package export must point to `./dist/tui/index.js`, not raw `./tui/index.tsx`: OpenCode/Bun does not reliably remap `.js` relative imports when loading raw TSX, while those targets exist only after the TypeScript build.
- OpenCode caches npm plugin specs by their literal specifier; an existing `~/.cache/opencode/packages/opencode-rules@next` wrapper pins the version resolved when it was created and does not refresh when `next` changes. Clear that cache or use an explicit new version when validating a release.
- tsconfig is strict-plus (`exactOptionalPropertyTypes`, `noUnusedLocals`/`noUnusedParameters`, `verbatimModuleSyntax`), so type-only imports and unused symbols will fail typecheck even though lint passes.
- Server source is grouped by domain: `src/rules/` (discovery, metadata, filter, hooks), `src/delivery/` (delivery engine composed behind `createRuleDelivery` plus codec and history port), `src/session/` (session/matched-rule state, file observations, message extraction, v2 message adapters), `src/runtime/` (orchestrator, runtime factory, client adapter, tool-hook flow, match context, chat capture), `src/detection/` (git-branch, project-fingerprint, mcp-tools), `src/shared/` (debug, bounded-session-map). `src/api-surface.typecheck.ts` enforces intentionally private exports during `tsc`.
- Do not edit generated `dist/`; `tsc` builds it from `src/` and `tui/`.
- This repo dogfoods its own plugin: `.opencode/rules/*.md` are injected into sessions and contain additional scoped guardrails.
- When adding/removing/renaming production modules, update the README "Project Structure" section in the same change (`.opencode/rules/11-readme-and-doc-sync.md`).

## Releases

- Stable publishing triggers on non-prerelease `v*` tags (the workflow does not verify branch containment). v2 beta tags must be contained by `dev` or `v2` and publish with the npm `next` dist-tag (npm rejects `v2`: it parses as a valid SemVer range); the v1 `beta` dist-tag stays frozen for v1 users.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `frap129/opencode-rules`, using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root plus `docs/adr/` for decisions. See `docs/agents/domain.md`.
