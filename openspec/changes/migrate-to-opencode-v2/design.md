# Design: migrate-to-opencode-v2

## Overview

This change migrates opencode-rules from the OpenCode V1 hook API to the OpenCode v2 plugin API. The migration is already implemented (Tasks 1-14); this change is the spec record of that implementation. V1 hooks (`experimental.chat.system.transform`, `experimental.chat.messages.transform`, `chat.message`, `experimental.session.compacting`) no longer exist in v2; the plugin now registers on the v2 `session context` hook plus `tool.execute.before/after`, and the TUI registers via `@opencode-ai/plugin/tui`.

## Goals / Non-Goals

- Goals:
  - Target OpenCode v2 only; V1 users stay on the last V1 release (`0.7.0-beta.x`).
  - Preserve rule discovery/injection semantics (globs/keywords/tools matching, per-turn injection, LRU session store) on the v2 surface.
  - Keep the delta against a moving beta API small and re-syncable.
- Non-Goals:
  - Supporting both V1 and V2 in one package.
  - Re-implementing compaction-context injection (no v2 equivalent).
  - Verifying host-side `PreToolUse` block propagation (see Risks).

## Decisions

- Decision: Promise API over effect API. The v2 `@opencode-ai/plugin` beta exposes an Effect-based variant; the plugin uses the plain Promise-returning surface (`Plugin.define`, async `setup`, `session.get` returning `Promise<SessionInfo>`). No Effect runtime dependency is introduced.
- Alternatives considered: adopting Effect everywhere (adds a runtime dependency and training cost for no feature need) vs. hand-rolling adapters (more code to maintain).

- Decision: Structural `src/v2-types.ts` confines beta churn. Payload shapes mirror `@opencode-ai/plugin@0.0.0-next-17335` structurally without importing them; the single cast lives in `src/index.ts` (`ctx as unknown as V2PluginContext`). Re-syncing a beta bump is a one-file edit plus the cast.
- Alternatives considered: importing beta types directly (spreads churn across every module and pins tests to beta internals) vs. fully untyped handlers (loses the type-safety requirement).

- Decision: Per-session directory resolution via `ctx.session.get({ sessionID })`, cached with a 30-second TTL and a separate fail cache. Project-rule discovery and path normalization are relative to the resolved project directory; a failed/absent lookup degrades gracefully instead of throwing.
- Alternatives considered: resolving once at setup (wrong directory for multi-workspace sessions) vs. scanning on every dispatch (unnecessary I/O).

- Decision: MCP `tools:` conditions match derived `mcp_<server>` candidates. V2 keys tools as `<sanitized-server>_<tool>` with no server-boundary marker, so every proper underscore prefix of a tool key is offered as a candidate (`context7_search` → `mcp_context7`; `my_server_search` → `mcp_my`, `mcp_my_server`). This preserves V1 rule files that declare server-level conditions. This approach was confirmed with the user during planning.
- Alternatives considered: exact tool-key matching only (breaks V1 rules like `tools: [mcp_context7]`) vs. maintaining a server-name registry (fragile, out-of-band).

- Decision: Snapshot pins for `@opentui/core` and `@opentui/solid` (`0.0.0-20260808-9ecf7c0a`), declared as required dependencies and optional peer dependencies. The TUI surface (`ui.slot`, `data`, `theme`) is not stable yet; snapshot pins make builds reproducible and peer-optionality keeps the server-only install lightweight.
- Alternatives considered: range constraints (may resolve incompatible TUI snapshots) vs. bundling the TUI runtime (bloats the server package).

- Decision: Compaction support dropped. v2 has no `experimental.session.compacting`; compaction-context injection is removed. `session-store.ts` retains its compacting/TTL internals (`markCompacting`, `shouldSkipInjection`) because nothing in the v2 runtime sets the flag, the gate is purely defensive and can be deleted once the beta stabilizes.

## Risks / Trade-offs

- Beta API churn (`@opencode-ai/plugin@0.0.0-next-17335`) → confined to `src/v2-types.ts` plus one cast in `src/index.ts`; re-sync against the next beta before the stable 1.0 release, and run `bun run build` + the test suite after every bump.
- Tool-key over-matching accepted: deriving every underscore prefix can over-match (e.g. `mcp_my` matches rules meant for a server literally named `my`). Accepted because exact-match rules (`tools: ["mcp_my"]`) retain precision and V1 compatibility wins.
- PreToolUse block propagation behavior unverified against the host: `tool.execute.after` (v2) may not propagate blocks the way V1's `PreToolUse` did; accepted because no current rule workflow depends on blocking tool execution, and it is deferred until a real requirement appears.
- Dropped compaction changes long-session behavior: context paths are no longer re-injected into the compaction context string; sessions relying on that V1 behavior should stay on `0.7.0-beta.x`.

## Migration Plan

- Implementation is complete (Tasks 1-14): manifest + entrypoints, runtime hooks, per-session directory resolution, MCP candidate derivation, compaction removal, README/dogfood config, `1.0.0-beta.1` release via the beta channel.
- Rollback: V1 users pin `0.7.0-beta.x`; the V1 code path was deleted from the tree, so rollback means restoring the last V1 release tag, not a flag.

## Active Changes Review

Reviewed all active changes against the v2 cutover (spec deltas describing V1 hooks as the target state conflict with this migration):

- `add-rule-filter-framework` — ARCHIVED. Its MODIFIED `System Prompt Rule Injection` delta describes `experimental.chat.system.transform` plus compacting-TTL skip as the target state; the v2 cutover replaces that hook with the session `context` hook and drops compaction. The filter-dimension work itself is v2-implementable (and largely present in `src/` as `rule-filter.ts`, `runtime-context.ts`, `project-fingerprint.ts`, `git-branch.ts`) but the change as written cannot be archived onto the v2 spec.
- `refactor-review-findings` — ARCHIVED. Its spec deltas target V1 surfaces: `Session Context Lifecycle` keeps the compacting/TTL scenarios and `experimental.chat.system.transform` references, and `package-setup`'s `TypeScript Package Configuration` delta keeps `PluginInput`/`serverUrl` mock semantics. The plan (`plan.md`) was authored against the pre-migration V1 code layout; the v2 migration restructured those modules. Its v2-agnostic goals (shared debug logger, async fs) are already absorbed into the migrated code (`src/debug.ts`, `rule-discovery.ts`). Its remaining goals were NOT absorbed and are deliberately superseded by the accepted v2 design, so the archived delta must not be read as binding: the "no module-level singleton" goal is not met (`src/index.ts` keeps a module-level `new SessionStore()` as the tested entry-point pattern), and the "no double type assertions" goal is not met by intent — the single structural cast `ctx as unknown as V2PluginContext` at `src/index.ts:33` is the accepted mechanism that confines beta API churn to `src/v2-types.ts`.
- `test` — LEFT ACTIVE. Contains only a `plan.md` placeholder with no spec deltas; nothing contradicts the v2 cutover and nothing is implementable as-is. Cleanup is out of scope for this change.
- `add-beta-channel-release` — LEFT ACTIVE. Empty change (no proposal, no tasks, no spec deltas); nothing contradicts the v2 cutover. Its intended scope (release via beta channel) is now covered by this migration's release task; re-propose or archive it separately.

## Deviations from Plan

1. **Dogfood config key**: `.opencode/opencode.json` and the README examples use the singular `"plugin"` key (not the plan's plural `"plugins"`), because the official config schema and the pinned `@opencode-ai/plugin@0.0.0-next-17335` `Config` type define only the singular key; a plural key is silently ignored by real binaries.
2. **`matcher` frontmatter + match-less hooks**: `matcher` support and hooks without `match` defaulting to match-any were added in commit `432aba8` (required by the V2 test rules' native hook shape). `matcher` is exact-name matched (`*` wildcard matches all tools), not a regex.
3. **Test fixture deviation**: `createRuntime` defaults `sessionStore` to `__testOnly.getSessionStore()` (the `src/index.ts` module-level store) instead of a fresh `new SessionStore()`, requiring the `getSessionStore` member on `__testOnly` — needed so `__testOnly.getSessionStateSnapshot`/`getSeedCount` assertions observe the runtime's state.

## Open Questions

- None blocking. Beta stability of `@opencode-ai/plugin` and `@opentui` is the main open variable and is handled by the re-sync risk above.
