# Proposal: refactor-review-findings

## Motivation

A comprehensive code review of opencode-rules v0.3.0 identified four medium-severity issues that cannot be safely auto-fixed. Each issue represents a maintainability, correctness, or performance concern that should be addressed before the next release:

1. **Synchronous file I/O blocks the event loop** -- `utils.ts` uses `readdirSync`, `readFileSync`, `existsSync`, and `statSync`. While the mtime cache mitigates repeated reads, the initial `statSync` check runs on every `onSystemTransform` call and directory scanning is fully synchronous.
2. **`debugLog` duplicated across three modules** -- The same `debugLog` closure pattern is copy-pasted in `index.ts`, `runtime.ts`, and `utils.ts`. Runtime already accepts it via dependency injection, but `utils.ts` has a hardcoded copy.
3. **Unsafe double type assertion in `onMessagesTransform`** -- The cast `output.messages as unknown as Parameters<typeof extractFilePathsFromMessages>[0]` bypasses type safety due to a mismatch between `MessageWithInfo` (from `message-context.ts`) and `Message` (from `utils.ts`).
4. **Module-level singleton `sessionStore`** -- Exported directly from `session-store.ts`, the singleton is shared across all imports. Tests require a special `__testOnly.resetSessionState()` escape hatch, and multi-instance use would cause cross-contamination.

## Scope

- **Capabilities affected:** `rule-discovery`, `package-setup`
- **Files affected:** `utils.ts`, `runtime.ts`, `index.ts`, `session-store.ts`, `message-context.ts`, and their corresponding test files
- **Risk:** Medium -- all changes are internal refactors with no public API changes. Existing test suite (133 tests) provides regression safety.

## Approach

Address each issue as an independent, incrementally deliverable refactor:

1. **Async file I/O**: Replace `fs` sync functions with `fs/promises` async equivalents. Propagate `async` through `getCachedRule`, `scanDirectoryRecursively`, and `readAndFormatRules`.
2. **Shared `debugLog`**: Extract the `debugLog` factory into a dedicated module (`debug.ts`) and inject it into `utils.ts` functions that need it, removing all hardcoded copies.
3. **Message type unification**: Create a shared message type (or adapter) that both `message-context.ts` and `utils.ts` agree on, eliminating the double `as unknown as` assertion.
4. **Session store DI**: Convert `sessionStore` from a module-level singleton to a factory function. The plugin entry point creates the instance and injects it; tests create their own isolated instances.

## Out of Scope

- Changing the plugin's public API or hook signatures
- Adding new features or capabilities
- Performance optimizations beyond removing sync I/O blocking
