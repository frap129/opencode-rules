# Refactor Review Findings — Implementation Plan

> **For OpenCode:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Eliminate code duplication, unsafe type casts, module-level singletons, and synchronous I/O across the opencode-rules plugin.

**Architecture:** Four independent-then-sequential refactors: (1) extract shared debug logger, (2) create message type adapter, (3) convert session store to factory, (4) migrate sync fs to async fs/promises. Each uses TDD — failing test first, minimal fix, commit.

**Tech Stack:** TypeScript, Vitest, Node.js `fs/promises`, ESM modules.

**Baseline:** 133 tests passing, `tsc --noEmit` clean.

---

## Phase 1: Foundations (Tasks 1 & 2 — no cross-dependencies)

---

### Task 1: Extract shared `debugLog` module

**Why:** `debugLog` is copy-pasted identically in `src/index.ts:15-19`, `src/runtime.ts:18-22`, and `src/utils.ts:15-19`. DRY violation.

**Files:**

- Create: `src/debug.ts`
- Create: `src/debug.test.ts`
- Modify: `src/utils.ts:5,15-19,62,67,327,340,425,431`
- Modify: `src/index.ts:15-19,31`
- Modify: `src/runtime.ts:16-22,61`

---

**Step 1: Write failing test for `createDebugLog`**

Create `src/debug.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDebugLog, type DebugLog } from './debug.js';

describe('createDebugLog', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;
  const originalEnv = process.env.OPENCODE_RULES_DEBUG;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    debugSpy.mockRestore();
    if (originalEnv === undefined) {
      delete process.env.OPENCODE_RULES_DEBUG;
    } else {
      process.env.OPENCODE_RULES_DEBUG = originalEnv;
    }
  });

  it('logs with default prefix when OPENCODE_RULES_DEBUG is set', () => {
    process.env.OPENCODE_RULES_DEBUG = '1';
    const log = createDebugLog();
    log('hello');
    expect(debugSpy).toHaveBeenCalledWith('[opencode-rules] hello');
  });

  it('does not log when OPENCODE_RULES_DEBUG is unset', () => {
    delete process.env.OPENCODE_RULES_DEBUG;
    const log = createDebugLog();
    log('hello');
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('uses custom prefix when provided', () => {
    process.env.OPENCODE_RULES_DEBUG = '1';
    const log = createDebugLog('my-module');
    log('test message');
    expect(debugSpy).toHaveBeenCalledWith('[my-module] test message');
  });

  it('returns a function matching DebugLog type signature', () => {
    const log: DebugLog = createDebugLog();
    expect(typeof log).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/debug.test.ts`
Expected: FAIL — `Cannot find module './debug.js'`

**Step 3: Implement `src/debug.ts`**

Create `src/debug.ts`:

```typescript
/**
 * Shared debug logging for opencode-rules.
 *
 * Usage:
 *   import { createDebugLog } from './debug.js';
 *   const debugLog = createDebugLog();
 */

export type DebugLog = (message: string) => void;

/**
 * Create a debug logger that only emits when OPENCODE_RULES_DEBUG is set.
 * @param prefix - Log prefix (default: 'opencode-rules')
 */
export function createDebugLog(prefix = 'opencode-rules'): DebugLog {
  return (message: string): void => {
    if (process.env.OPENCODE_RULES_DEBUG) {
      console.debug(`[${prefix}] ${message}`);
    }
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/debug.test.ts`
Expected: PASS (4 tests)

**Step 5: Replace `debugLog` in `src/utils.ts`**

In `src/utils.ts`:

1. Add import at top (after line 9):

```typescript
import { createDebugLog } from './debug.js';
```

2. Replace the local `debugLog` function (lines 11-19) with:

```typescript
const debugLog = createDebugLog();
```

This removes the 9 lines (comment + function) and replaces with a single const. The rest of `utils.ts` calls `debugLog(...)` identically — no callers change.

**Step 6: Replace `debugLog` in `src/index.ts`**

In `src/index.ts`:

1. Add import (after line 9):

```typescript
import { createDebugLog } from './debug.js';
```

2. Replace lines 12-19 (comment + function) with:

```typescript
const debugLog = createDebugLog();
```

Line 31 still passes `debugLog` to the runtime constructor — no change needed.

**Step 7: Replace `defaultDebugLog` in `src/runtime.ts`**

In `src/runtime.ts`:

1. Add import (after line 13):

```typescript
import { createDebugLog } from './debug.js';
```

2. Remove the `DebugLog` type alias on line 16 and import it instead. Update the import line to:

```typescript
import { createDebugLog, type DebugLog } from './debug.js';
```

3. Replace lines 18-22 (`function defaultDebugLog...`) with:

```typescript
const defaultDebugLog = createDebugLog();
```

Line 61 (`this.debugLog = opts.debugLog ?? defaultDebugLog;`) stays the same.

**Step 8: Run full test suite**

Run: `npx vitest run`
Expected: 133 tests pass (all files)

Run: `npx tsc --noEmit`
Expected: Clean (no errors)

**Step 9: Commit**

```bash
git add src/debug.ts src/debug.test.ts src/utils.ts src/index.ts src/runtime.ts
git commit -m "refactor: extract shared debugLog into src/debug.ts"
```

---

### Task 2: Create message type adapter (`toExtractableMessages`)

**Why:** `src/runtime.ts:135-139` uses `as unknown as` double assertion to coerce `MessageWithInfo[]` → `Message[]`. Unsafe — silently passes messages with missing `role` or `parts`, causing potential runtime errors in `extractFilePathsFromMessages`.

**Files:**

- Modify: `src/message-context.ts` (add adapter function)
- Modify: `src/message-context.test.ts` (add adapter tests)
- Modify: `src/runtime.ts:1-5,135-139` (use adapter, add import)

---

**Step 1: Write failing tests for `toExtractableMessages`**

Add to `src/message-context.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

import {
  sanitizePathForContext,
  extractLatestUserPrompt,
  extractSessionID,
  toExtractableMessages,
} from './message-context.js';

// ... existing tests stay as-is ...

describe('toExtractableMessages', () => {
  it('passes through messages with both role and parts', () => {
    const messages = [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
      },
    ];
    const result = toExtractableMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    expect(result[0].parts).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('filters out messages with missing role', () => {
    const messages = [
      { parts: [{ type: 'text', text: 'no role' }] },
      { role: 'user', parts: [{ type: 'text', text: 'has role' }] },
    ];
    const result = toExtractableMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
  });

  it('filters out messages with missing parts', () => {
    const messages = [
      { role: 'user' },
      { role: 'assistant', parts: [{ type: 'text', text: 'ok' }] },
    ];
    const result = toExtractableMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
  });

  it('filters out messages with empty parts array', () => {
    const messages = [
      { role: 'user', parts: [] as any[] },
      { role: 'assistant', parts: [{ type: 'text', text: 'ok' }] },
    ];
    const result = toExtractableMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
  });

  it('returns empty array when all messages are invalid', () => {
    const messages = [{ parts: [{ type: 'text' }] }, { role: 'user' }, {}];
    const result = toExtractableMessages(messages);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    const result = toExtractableMessages([]);
    expect(result).toEqual([]);
  });

  it('preserves tool-invocation parts in output', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-invocation',
            toolInvocation: {
              toolName: 'read',
              args: { filePath: 'src/index.ts' },
            },
          },
        ],
      },
    ];
    const result = toExtractableMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].parts[0].type).toBe('tool-invocation');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/message-context.test.ts`
Expected: FAIL — `toExtractableMessages` is not exported from `./message-context.js`

**Step 3: Implement `toExtractableMessages` in `src/message-context.ts`**

Add the following import at the top of `src/message-context.ts`, and the function at the end of the file:

Add import for the `Message` type from utils (at top of file, after line 1):

```typescript
import type { Message } from './utils.js';
```

Add function at end of file (after line 91):

```typescript
/**
 * Safely convert MessageWithInfo[] to Message[] for extractFilePathsFromMessages.
 * Filters out messages missing required `role` or `parts` fields.
 */
export function toExtractableMessages(messages: MessageWithInfo[]): Message[] {
  const result: Message[] = [];
  for (const msg of messages) {
    if (msg.role && msg.parts && msg.parts.length > 0) {
      result.push({
        role: msg.role,
        parts: msg.parts as Message['parts'],
      });
    }
  }
  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/message-context.test.ts`
Expected: PASS (all tests including new 7)

**Step 5: Replace unsafe cast in `src/runtime.ts`**

In `src/runtime.ts`:

1. Update the import from `message-context.ts` (lines 6-12) to include `toExtractableMessages`:

Change:

```typescript
import {
  extractLatestUserPrompt,
  extractSessionID,
  normalizeContextPath,
  sanitizePathForContext,
  type MessageWithInfo,
} from './message-context.js';
```

To:

```typescript
import {
  extractLatestUserPrompt,
  extractSessionID,
  normalizeContextPath,
  sanitizePathForContext,
  toExtractableMessages,
  type MessageWithInfo,
} from './message-context.js';
```

2. Replace lines 135-139:

Change:

```typescript
const contextPaths = extractFilePathsFromMessages(
  output.messages as unknown as Parameters<
    typeof extractFilePathsFromMessages
  >[0]
);
```

To:

```typescript
const contextPaths = extractFilePathsFromMessages(
  toExtractableMessages(output.messages)
);
```

**Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (133 existing + 11 new = 144)

Run: `npx tsc --noEmit`
Expected: Clean

**Step 7: Commit**

```bash
git add src/message-context.ts src/message-context.test.ts src/runtime.ts
git commit -m "refactor: replace unsafe message type cast with toExtractableMessages adapter"
```

---

## Phase 2: Session Store Refactor

---

### Task 3: Convert session store to factory pattern

**Why:** `src/session-store.ts:123` exports a module-level singleton (`export const sessionStore = new SessionStore({ max: 100 })`). This couples `index.ts` to a global and makes tests rely on reset methods. A factory function is more testable and explicit.

**Design constraint:** The `__testOnly` API in `index.ts` (lines 43-67) MUST continue to work identically. Integration tests in `index.test.ts` use `__testOnly.resetSessionState()`, `__testOnly.upsertSessionState()`, etc.

**Files:**

- Modify: `src/session-store.ts:123` (add factory, remove singleton)
- Modify: `src/session-store.test.ts` (add factory test)
- Modify: `src/index.ts:10,30,46-64` (use factory, reference local instance)

---

**Step 1: Write failing test for `createSessionStore`**

Add to end of `src/session-store.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SessionStore, createSessionStore } from './session-store.js';

// ... existing tests stay as-is ...

describe('createSessionStore', () => {
  it('creates a SessionStore with default options', () => {
    const store = createSessionStore();
    expect(store).toBeInstanceOf(SessionStore);
    // Default max is 100; inserting 101 should evict one
    for (let i = 0; i <= 100; i++) {
      store.upsert(`s_${i}`, () => {});
    }
    expect(store.ids()).toHaveLength(100);
  });

  it('creates a SessionStore with custom max', () => {
    const store = createSessionStore({ max: 5 });
    for (let i = 0; i < 10; i++) {
      store.upsert(`s_${i}`, () => {});
    }
    expect(store.ids()).toHaveLength(5);
  });

  it('creates independent instances', () => {
    const store1 = createSessionStore({ max: 10 });
    const store2 = createSessionStore({ max: 10 });
    store1.upsert('only-in-1', () => {});
    expect(store1.ids()).toContain('only-in-1');
    expect(store2.ids()).not.toContain('only-in-1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/session-store.test.ts`
Expected: FAIL — `createSessionStore` is not exported

**Step 3: Implement `createSessionStore` and remove singleton**

In `src/session-store.ts`, replace line 123:

Change:

```typescript
export const sessionStore = new SessionStore({ max: 100 });
```

To:

```typescript
/**
 * Create a new SessionStore instance.
 * @param opts - Store options (max capacity defaults to 100)
 */
export function createSessionStore(
  opts: SessionStoreOptions = {}
): SessionStore {
  return new SessionStore(opts);
}
```

**Step 4: Run session-store tests to verify they pass**

Run: `npx vitest run src/session-store.test.ts`
Expected: PASS (6 tests — 3 existing + 3 new)

**Step 5: Update `src/index.ts` to use factory**

In `src/index.ts`:

1. Change import on line 10:

Change:

```typescript
import { sessionStore, type SessionState } from './session-store.js';
```

To:

```typescript
import { createSessionStore, type SessionState } from './session-store.js';
```

2. Add instance creation before the plugin function (after the `debugLog` line, before line 21):

```typescript
const sessionStore = createSessionStore({ max: 100 });
```

The rest of `index.ts` already references `sessionStore` as a local variable — no other changes needed. The `__testOnly` closure captures `sessionStore` and continues to work identically.

**Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (should be 147+ including new factory tests)

Run: `npx tsc --noEmit`
Expected: Clean

**Step 7: Commit**

```bash
git add src/session-store.ts src/session-store.test.ts src/index.ts
git commit -m "refactor: replace session store singleton with createSessionStore factory"
```

---

## Phase 3: Async File I/O Migration

---

### Task 4: Migrate sync fs to async `fs/promises`

**Why:** `src/utils.ts` uses `readdirSync`, `readFileSync`, `existsSync`, `statSync`. These block the event loop. The functions that call them (`getCachedRule`, `scanDirectoryRecursively`, `discoverRuleFiles`, `readAndFormatRules`) are already `async` or called from async contexts.

**This is the largest task. It touches many tests because `index.test.ts` uses real filesystem operations (tmpdir), which continue to work as-is with async. The key change is the `src/utils.ts` internals.**

**Files:**

- Modify: `src/utils.ts:5,54-90,257-295,322-346,374-449`

---

**Step 4a: Convert `getCachedRule` and `scanDirectoryRecursively` to async**

**Step 4a.1: Modify `src/utils.ts` imports**

Change line 5:

```typescript
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
```

To:

```typescript
import { stat, readFile, readdir } from 'fs/promises';
```

**Step 4a.2: Convert `getCachedRule` to async**

Replace the `getCachedRule` function (lines 54-90):

Change:

```typescript
function getCachedRule(filePath: string): CachedRule | undefined {
  try {
    const stats = statSync(filePath);
    const mtime = stats.mtimeMs;

    // Check if we have a valid cached entry
    const cached = ruleCache.get(filePath);
    if (cached && cached.mtime === mtime) {
      debugLog(`Cache hit: ${filePath}`);
      return cached;
    }

    // Read and cache the file
    debugLog(`Cache miss: ${filePath}`);
    const content = readFileSync(filePath, 'utf-8');
    const metadata = parseRuleMetadata(content);
    const strippedContent = stripFrontmatter(content);

    const entry: CachedRule = {
      content,
      metadata,
      strippedContent,
      mtime,
    };

    ruleCache.set(filePath, entry);
    return entry;
  } catch (error) {
    // Remove stale cache entry if file no longer exists
    ruleCache.delete(filePath);
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[opencode-rules] Warning: Failed to read rule file ${filePath}: ${message}`
    );
    return undefined;
  }
}
```

To:

```typescript
async function getCachedRule(
  filePath: string
): Promise<CachedRule | undefined> {
  try {
    const stats = await stat(filePath);
    const mtime = stats.mtimeMs;

    // Check if we have a valid cached entry
    const cached = ruleCache.get(filePath);
    if (cached && cached.mtime === mtime) {
      debugLog(`Cache hit: ${filePath}`);
      return cached;
    }

    // Read and cache the file
    debugLog(`Cache miss: ${filePath}`);
    const content = await readFile(filePath, 'utf-8');
    const metadata = parseRuleMetadata(content);
    const strippedContent = stripFrontmatter(content);

    const entry: CachedRule = {
      content,
      metadata,
      strippedContent,
      mtime,
    };

    ruleCache.set(filePath, entry);
    return entry;
  } catch (error) {
    // Remove stale cache entry if file no longer exists
    ruleCache.delete(filePath);
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[opencode-rules] Warning: Failed to read rule file ${filePath}: ${message}`
    );
    return undefined;
  }
}
```

**Step 4a.3: Add `await` in `readAndFormatRules` caller**

In `readAndFormatRules` (line 392), change:

```typescript
const cachedRule = getCachedRule(filePath);
```

To:

```typescript
const cachedRule = await getCachedRule(filePath);
```

This is the only caller. `readAndFormatRules` is already `async`, so adding `await` is safe.

**Step 4a.4: Convert `scanDirectoryRecursively` to async**

Replace the `scanDirectoryRecursively` function (lines 257-295):

Change:

```typescript
function scanDirectoryRecursively(
  dir: string,
  baseDir: string
): Array<{ filePath: string; relativePath: string }> {
  const results: Array<{ filePath: string; relativePath: string }> = [];

  if (!existsSync(dir)) {
    return results;
  }

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden files and directories
      if (entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recurse into subdirectory
        results.push(...scanDirectoryRecursively(fullPath, baseDir));
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdc')) {
        // Add markdown file
        const relativePath = path.relative(baseDir, fullPath);
        results.push({ filePath: fullPath, relativePath });
      }
    }
  } catch (error) {
    // Log directory read errors instead of silently ignoring
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[opencode-rules] Warning: Failed to read directory ${dir}: ${message}`
    );
  }

  return results;
}
```

To:

```typescript
async function scanDirectoryRecursively(
  dir: string,
  baseDir: string
): Promise<Array<{ filePath: string; relativePath: string }>> {
  const results: Array<{ filePath: string; relativePath: string }> = [];

  try {
    await stat(dir);
  } catch {
    // Directory does not exist
    return results;
  }

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden files and directories
      if (entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recurse into subdirectory
        results.push(...(await scanDirectoryRecursively(fullPath, baseDir)));
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdc')) {
        // Add markdown file
        const relativePath = path.relative(baseDir, fullPath);
        results.push({ filePath: fullPath, relativePath });
      }
    }
  } catch (error) {
    // Log directory read errors instead of silently ignoring
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[opencode-rules] Warning: Failed to read directory ${dir}: ${message}`
    );
  }

  return results;
}
```

**Step 4a.5: Add `await` in `discoverRuleFiles` callers**

In `discoverRuleFiles` (lines 314-346), the calls to `scanDirectoryRecursively` are already inside an `async` function. Change:

Line 322-325:

```typescript
const globalRules = scanDirectoryRecursively(globalRulesDir, globalRulesDir);
```

To:

```typescript
const globalRules = await scanDirectoryRecursively(
  globalRulesDir,
  globalRulesDir
);
```

Lines 335-338:

```typescript
const projectRules = scanDirectoryRecursively(projectRulesDir, projectRulesDir);
```

To:

```typescript
const projectRules = await scanDirectoryRecursively(
  projectRulesDir,
  projectRulesDir
);
```

**Step 4a.6: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass. The integration tests in `index.test.ts` use real tmpdir files (not mocked fs), so they work identically with async fs.

Run: `npx tsc --noEmit`
Expected: Clean

**Step 4a.7: Commit**

```bash
git add src/utils.ts
git commit -m "refactor: migrate sync fs operations to async fs/promises"
```

---

## Phase 4: Final Validation

---

### Task 5: Final validation pass

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 2: Run type checker**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Run linter**

Run: `npx eslint src`
Expected: Clean (or only pre-existing warnings)

**Step 4: Verify no regressions in test count**

Expected: 147+ tests (133 baseline + 4 debug + 7 adapter + 3 factory = 147)

---

## Summary of Changes

| Task                | Files Modified                                                | Files Created               | Tests Added              |
| ------------------- | ------------------------------------------------------------- | --------------------------- | ------------------------ |
| 1. Extract debugLog | `utils.ts`, `index.ts`, `runtime.ts`                          | `debug.ts`, `debug.test.ts` | 4                        |
| 2. Message adapter  | `message-context.ts`, `message-context.test.ts`, `runtime.ts` | —                           | 7                        |
| 3. Session factory  | `session-store.ts`, `session-store.test.ts`, `index.ts`       | —                           | 3                        |
| 4. Async fs         | `utils.ts`                                                    | —                           | 0 (existing tests cover) |

## Commit Sequence

1. `refactor: extract shared debugLog into src/debug.ts`
2. `refactor: replace unsafe message type cast with toExtractableMessages adapter`
3. `refactor: replace session store singleton with createSessionStore factory`
4. `refactor: migrate sync fs operations to async fs/promises`
