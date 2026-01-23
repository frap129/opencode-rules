## Context

The opencode-rules plugin uses a `sessionContextMap` to pass context between two hooks: `experimental.chat.messages.transform` extracts file paths and user prompt, then `experimental.chat.system.transform` uses this context to filter conditional rules. The current implementation grows unbounded because entries are never deleted.

Additionally, rule files are read synchronously on every `system.transform` call, causing redundant I/O for unchanged files.

## Goals / Non-Goals

**Goals:**

- Prevent unbounded memory growth in `sessionContextMap`
- Cache parsed rule content to avoid redundant file reads
- Maintain backward compatibility with existing behavior

**Non-Goals:**

- Implementing WeakMap (not possible since session IDs are strings)
- Converting to fully async I/O (larger scope change)
- Distributed caching or shared state

## Decisions

### Decision 1: Delete-on-use cleanup for sessionContextMap

Delete the session context entry immediately after `system.transform` reads it.

**Rationale:**

- The `system.transform` hook receives `sessionID` in its input, indicating the system considers this a one-time use per request
- Delete-on-use is simple and deterministic - no TTL timers or size checks needed
- If the hook is called multiple times per session (unexpected), the second call gets empty context which is safe (rules still apply, just without conditional filtering)

**Alternatives considered:**

- TTL-based eviction: More complex, requires timers, harder to test
- LRU with size cap: More complex, entry count varies unpredictably
- WeakMap: Not possible with string keys

**Implementation:**

```typescript
const sessionContext = sessionID ? sessionContextMap.get(sessionID) : undefined;
if (sessionID) {
  sessionContextMap.delete(sessionID);
}
```

### Decision 2: Mtime-based file content caching

Cache parsed rule files keyed by absolute path, with mtime-based invalidation.

**Rationale:**

- Rules change infrequently relative to how often they're read
- Mtime check is a single `statSync` call, much cheaper than `readFileSync` + parsing
- Simple to implement with a Map

**Cache structure:**

```typescript
interface CachedRule {
  content: string;
  metadata: RuleMetadata | undefined;
  strippedContent: string;
  mtime: number;
}
const ruleCache = new Map<string, CachedRule>();
```

**Invalidation:** Check `statSync(path).mtimeMs` before using cached entry.

### Decision 3: YAML parsing with `yaml` package

Use the `yaml` package (v2.7+) instead of regex for frontmatter parsing.

**Rationale:**

- Handles inline arrays: `globs: ["*.ts", "*.js"]`
- Handles keys in any case
- Standard YAML semantics for quoting, escaping, etc.
- ~150KB package size, well-maintained

**Alternatives considered:**

- `gray-matter`: Larger footprint, includes more features than needed
- Improve regex: Fragile, edge cases compound

### Decision 4: Compiled glob/keyword matchers

Pre-compile glob patterns and keyword regexes once per rule file.

**Rationale:**

- `minimatch` pattern compilation happens on every match call
- Keyword regex creation happens on every prompt check
- Caching these with the rule content eliminates redundant work

## Risks / Trade-offs

| Risk                                            | Mitigation                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Delete-on-use drops context if hook fires twice | Document single-shot assumption; second call still works, just without conditional context |
| Stale cache if file modified during request     | Mtime granularity is 1ms; acceptable for human-edited rule files                           |
| `yaml` dependency adds 150KB                    | Acceptable for proper YAML parsing; no runtime alternatives                                |

## Migration Plan

1. Add `yaml` dependency
2. Implement changes in phases (test mocks → type safety → memory → caching)
3. Run full test suite after each phase
4. No data migration needed - runtime state only

## Open Questions

None - all decisions are straightforward given the constraints.
