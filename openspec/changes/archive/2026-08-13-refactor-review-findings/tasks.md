# Tasks: refactor-review-findings

## Task List

### Phase 1: Foundations (no cross-dependencies)

- [ ] **1. Extract shared `debugLog` module**
  - Create `src/debug.ts` with `createDebugLog(prefix?: string)` factory
  - Remove inline `debugLog` from `index.ts`, `runtime.ts`, `utils.ts`
  - Update `utils.ts` functions to accept optional `debugLog` parameter, defaulting to factory output
  - Update `runtime.ts` `defaultDebugLog` to use the shared factory
  - Run: `bun run test` -- all 133 tests pass
  - Run: `bun run lint` -- no new warnings
  - Run: `bun run typecheck` -- compiles clean

- [ ] **2. Create message type adapter**
  - Add `toExtractableMessages(messages: MessageWithInfo[]): Message[]` to `message-context.ts`
  - Adapter filters out messages where `role` or `parts` are undefined/empty
  - Replace `as unknown as` cast in `runtime.ts` `onMessagesTransform` with adapter call
  - Add unit tests for the adapter (valid messages, missing role, missing parts, empty parts)
  - Run: `bun run test` -- all tests pass
  - Run: `bun run typecheck` -- no type errors

### Phase 2: Session Store Refactor

- [ ] **3. Convert session store to factory pattern**
  - Add `export function createSessionStore(opts?)` to `session-store.ts`
  - Remove `export const sessionStore = new SessionStore(...)` singleton
  - Update `index.ts` to call `createSessionStore({ max: 100 })` and inject into runtime
  - Update tests to create isolated instances instead of using `__testOnly.resetSessionState()`
  - Remove `resetSessionState` from `__testOnly` exports if no longer needed
  - Run: `bun run test` -- all tests pass

### Phase 3: Async File I/O Migration

- [ ] **4. Migrate `getCachedRule` to async**
  - Replace `import { statSync, readFileSync, ... } from 'fs'` with `import { stat, readFile, readdir } from 'fs/promises'`
  - Convert `getCachedRule()` to `async getCachedRule()` using `await stat()` and `await readFile()`
  - Replace `existsSync` checks with `stat` + try/catch
  - Update all callers of `getCachedRule` to `await`
  - Update test mocks from `fs` to `fs/promises`
  - Run: `bun run test` -- all tests pass

- [ ] **5. Migrate `scanDirectoryRecursively` to async**
  - Convert to `async scanDirectoryRecursively()` using `await readdir(..., { withFileTypes: true })`
  - Update `discoverRuleFiles()` to await the async scan
  - Update test mocks for directory scanning
  - Run: `bun run test` -- all tests pass
  - Run: `bun run typecheck` -- compiles clean

### Phase 4: Documentation & Validation

- [ ] **6. Update README to reflect async file operations**
  - Update any references to synchronous file reads to describe async behavior
  - Verify documentation accuracy against implementation

- [ ] **7. Final validation**
  - Run: `bun run test` -- full suite passes
  - Run: `bun run lint` -- clean
  - Run: `bun run typecheck` -- clean
  - Run: `openspec validate refactor-review-findings --strict` -- passes
