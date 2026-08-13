# Design: refactor-review-findings

## Overview

This change addresses four cross-cutting refactoring concerns discovered during code review. Each issue is independent but collectively they improve type safety, testability, and runtime performance.

## Decision 1: Async File I/O Migration

### Problem

`utils.ts` imports from `'fs'` and uses `readdirSync`, `readFileSync`, `existsSync`, and `statSync`. The mtime cache prevents redundant reads, but `statSync` still runs on every `onSystemTransform` hook invocation to check cache validity, blocking the event loop.

### Options Considered

1. **Full async migration** -- Replace all sync fs calls with `fs/promises` equivalents (`readdir`, `readFile`, `stat`, `access`). Propagate `async` through the call chain.
2. **Worker thread offload** -- Keep sync API but offload to a worker thread.
3. **Status quo with documentation** -- Document the sync behavior as intentional.

### Decision

Option 1: Full async migration. The call chain is already partially async (`discoverRuleFiles` is `async`), and the plugin hooks are async by nature (`Promise<void>`). Worker threads add unnecessary complexity for simple file reads.

### Impact

- `getCachedRule()` becomes `async getCachedRule()`
- `scanDirectoryRecursively()` becomes `async scanDirectoryRecursively()`
- `readAndFormatRules()` callers already `await` it (it returns `Promise<string>`), so no caller changes needed
- `existsSync` replaced with `stat` + catch (no `access` needed since we stat anyway)
- Tests that mock `fs` must switch to mocking `fs/promises`

## Decision 2: Shared Debug Log

### Problem

Three copies of the same `debugLog` pattern exist:

- `index.ts:15-18`
- `runtime.ts:18-22` (as `defaultDebugLog`)
- `utils.ts:15-19`

`runtime.ts` already accepts `debugLog` via its options interface, but `utils.ts` functions use a hardcoded module-level copy.

### Options Considered

1. **Shared module** -- Extract `createDebugLog()` into `debug.ts`, import everywhere.
2. **Thread `debugLog` through function parameters** -- Pass `debugLog` as a parameter to every `utils.ts` function that logs.
3. **Hybrid** -- Shared module for the factory, DI for runtime override.

### Decision

Option 3: Hybrid. Create `debug.ts` exporting `createDebugLog(prefix?: string)` which reads `OPENCODE_RULES_DEBUG` and returns the log function. `runtime.ts` continues to accept an optional override via DI. `utils.ts` functions that need logging accept an optional `debugLog` parameter, defaulting to the shared factory output.

### Impact

- New file: `src/debug.ts` (~10 lines)
- `index.ts`, `runtime.ts`, `utils.ts` remove their local `debugLog` definitions
- Function signatures in `utils.ts` gain optional `debugLog` parameter where used
- No behavior change; only wiring changes

## Decision 3: Message Type Unification

### Problem

`message-context.ts` defines `MessageWithInfo` with all-optional fields (`role?`, `parts?`). `utils.ts` defines `Message` with required fields (`role: string`, `parts: MessagePart[]`). `runtime.ts` bridges them with an unsafe double assertion: `output.messages as unknown as ...`.

### Options Considered

1. **Unify into a single type** -- Make one `Message` type that satisfies both use sites.
2. **Adapter function** -- Create `toMessage(m: MessageWithInfo): Message | null` that safely validates and converts.
3. **Relax `utils.ts` types** -- Make `Message` fields optional to match `MessageWithInfo`.

### Decision

Option 2: Adapter function. The types come from different sources (`@opencode-ai/plugin` vs local definitions). Unifying them would couple to an external API. An adapter provides a safe boundary with runtime validation, filtering out messages with missing required fields.

### Impact

- New function in `message-context.ts`: `toExtractableMessages(messages: MessageWithInfo[]): Message[]`
- `runtime.ts` replaces the `as unknown as` cast with the adapter call
- `utils.ts` `Message` type remains strict (required fields)
- Adapter filters out messages where `role` or `parts` are undefined

## Decision 4: Session Store Factory

### Problem

`session-store.ts` exports a module-level singleton `export const sessionStore = new SessionStore({ max: 100 })`. All importers share this instance. Tests require `__testOnly.resetSessionState()` to avoid cross-contamination. The current spec uses a bounded LRU eviction model where session state persists across hooks -- the factory/DI concern is orthogonal to the eviction strategy.

### Options Considered

1. **Factory function** -- Export `createSessionStore(opts)` instead of a singleton. Entry point creates and injects.
2. **Full DI container** -- Use a DI framework or container pattern.
3. **Keep singleton, improve test reset** -- Add a proper `reset()` method.

### Decision

Option 1: Factory function. This is the lightest change: export `createSessionStore()` as the primary API, keep `SessionStore` class exported for typing. The plugin entry point (`index.ts`) creates the instance and passes it to the runtime. The LRU eviction behavior and persistence-across-hooks semantics remain unchanged. No DI framework needed.

### Impact

- `session-store.ts`: Remove `export const sessionStore = ...`. Add `export function createSessionStore(opts?) { return new SessionStore(opts) }`.
- `index.ts`: Call `createSessionStore({ max: 100 })` and pass result to runtime.
- Tests: Create isolated instances directly via `createSessionStore()` or `new SessionStore()`; remove `__testOnly.resetSessionState()` usage.
- `__testOnly` may still be needed for other test utilities but `resetSessionState` becomes unnecessary.
