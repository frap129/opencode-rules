# Session Compaction Handling

## Problem

When OpenCode compacts a session (summarizes conversation history to manage context windows), file paths mentioned in tool calls may be lost in the summary. This causes conditional rules that match those paths to stop applying after compaction.

## Solution

The plugin uses **working-set context injection** to persist file paths through compaction: when a session is compacted, the current working set of files is injected into the compaction summary so the compaction LLM naturally includes them.

## Implementation

### Working-Set Context Injection

When a session is compacted, the `experimental.session.compacting` hook injects the current file paths into the compaction output:

```typescript
'experimental.session.compacting': async (input, output) => {
  const sessionState = sessionStateMap.get(input.sessionID);
  const paths = Array.from(sessionState.workingContextPaths).sort();

  // Build minimal context string with sanitized paths
  const contextString = [
    'OpenCode Rules: Working context',
    'Current file paths in context:',
    ...paths.slice(0, 20).map(p => `  - ${sanitizePathForContext(p)}`),
    ...(paths.length > 20
      ? [`  ... and ${paths.length - 20} more paths`]
      : []),
  ].join('\n');

  // Add to output context array
  output.context.push(contextString);
};
```

**How it works:**

- During compaction, OpenCode calls the `experimental.session.compacting` hook
- We extract the current Working context (file paths the user was working with)
- We add a minimal context string that the compaction LLM includes in the summary
- We invalidate the RuleDelivery ledger so it is rebuilt from post-compaction request history's synthetic delivery metadata — not from summary prose and not from historical tool events
- Durable rules removed by compaction are re-appended; rules still present are not duplicated
- Preserved paths keep the Working-context projection available, but rule matching always comes from live File observations

**Why this works:**

- **Efficient**: Only injects the current working set (max 20 paths), not full rules
- **Deterministic**: Paths are sorted for consistent output
- **Safe**: Paths are sanitized to prevent prompt injection via control characters
- **Minimal**: Separate from rule injection to keep compaction token usage low

### Incremental Context Capture

The plugin builds the Working context from successful live events and eligible
history parts (paths only, never content):

1. **`tool.execute.after`**: Successful Read, Write, Edit, Apply Patch, and path-associated LSP events contribute normalized paths (and File observations for matching)
2. **`experimental.chat.messages.transform`**: Rebuilds path-only Working context from message history on first encounter
3. **`chat.message`**: Updates Working context with tool parts of the current message

This multi-hook approach ensures:

- File paths are captured as soon as tools are used
- Session state persists across turns without rescanning
- No redundant message history scanning after the first turn

### Session State Persistence

Per-session state is stored in `sessionStateMap` with the following structure:

```typescript
interface SessionState {
  workingContextPaths: Set<string>; // Current working set of file paths
  lastUserPrompt?: string; // Latest user message text
  workingContextSeeded: boolean; // Flag: first successful seeding source completed
  lastModelID?: string; // Latest model ID
  lastAgentType?: string; // Latest agent type
  ruleSnapshots?: RuleSnapshot[]; // Per-session rule snapshot (process lifetime)
}
```

Delivery bookkeeping (dedup ledger, pending Hook queues, rescan flag) lives in
the runtime-owned `RuleDelivery` instance, not in SessionState.

- Maximum of 100 concurrent sessions in memory (LRU eviction)
- Eviction is owned by the internal `BoundedSessionMap` each store composes;
  entries are stamped on write/read access and the least-recently-stamped
  session is pruned when the limit is exceeded
- Compaction invalidates durable delivery identities; the next transformed request rebuilds them from surviving synthetic delivery metadata, missing durable rules are re-appended, and ephemeral rules are recomputed per request

## Data Flow

### Normal Turn

```
live tool.execute.after
    ↓
FileObservationContext (matching, resident process only)
    ↓
SessionWorkingContext (path-only compaction projection)
    ↓
chat.message: initial session-durable matching rules append to the user
message as one synthetic part; a Durable Rule first matched by a live File
observation is admitted immediately through a no-reply session.prompt
(earliest dispatch), with transient fallback and retry; ephemeral rules
(agent, model, branch, tools) are delivered only in the transformed model
request
    ↓
AI processes request with full context
```

### On Compaction

```
OpenCode triggers compaction (context window management)
    ↓
experimental.session.compacting hook runs
    ↓
Working context projection (up to 20 sorted paths, no content) injected into compaction context
    ↓
Compaction LLM generates summary including injected file paths
    ↓
Session context preserved through compaction
    ↓
Post-compaction transform rebuilds the delivery ledger from surviving synthetic delivery metadata
    ↓
Missing durable rules are re-appended;
ephemeral rules are recomputed per request
```

## Benefits

1. **Transparent**: No user configuration required
2. **Deterministic**: Same paths always produce consistent output
3. **Safe**: Sanitization prevents prompt injection attacks
4. **Memory-efficient**: Only keeps current working set, not full history
5. **Session-aware**: Handles multiple concurrent sessions correctly
6. **Conditional-rule-safe**: File paths persist through compaction

## Security

### Path Sanitization

Paths are sanitized before inclusion in compaction context to prevent prompt injection:

```typescript
const sanitizePathForContext = (p: string): string =>
  p.replace(/[\r\n\t]/g, ' ').slice(0, 300);
```

This removes control characters (newlines, tabs) and limits path length to 300 characters, preventing:

- Injection of instructions via newlines
- Excessive context bloat from extremely long paths
- Control character exploits

## Testing

The implementation includes comprehensive tests:

```typescript
it('adds minimal working-set context during compaction', async () => {
  // Seed session with paths
  __testOnly.upsertSessionState('ses_c', s => {
    s.workingContextPaths.add('src/components/Button.tsx');
    s.workingContextPaths.add('src/utils/helpers.ts');
  });

  // Call compacting hook
  const compacting = hooks['experimental.session.compacting'];
  const output = { context: [] as string[] };
  await compacting({ sessionID: 'ses_c' }, output);

  // Verify paths in output
  expect(output.context.join('\n')).toContain('src/components/Button.tsx');
});

it('includes "... and X more" when paths exceed 20', async () => {
  // Seed with 25 paths
  __testOnly.upsertSessionState('ses_x', s => {
    for (let i = 1; i <= 25; i++) {
      s.workingContextPaths.add(`path/to/file${i}.ts`);
    }
  });

  const output = { context: [] as string[] };
  await compacting({ sessionID: 'ses_x' }, output);

  // Verify only 20 shown and remainder indicated
  const text = output.context.join('\n');
  expect(text).toContain('... and 5 more paths');
  expect((text.match(/path\/to\/file\d+\.ts/g) || []).length).toBe(20);
});
```

## Logs

When running with `OPENCODE_RULES_DEBUG=1`, you'll see:

```
[opencode-rules] Recorded Working-context path from live tool read: src/components/Button.tsx
[opencode-rules] Seeded 5 Working-context path(s) for session ses_abc123
[opencode-rules] Updated lastUserPrompt for session ses_abc123 (len=42, parts=1)
[opencode-rules] Added 20 Working-context path(s) to compaction for session ses_abc123
```

## Alternative Approaches Considered

### ❌ Silent Messages (Legacy)

**Why not**: OpenCode plugin API doesn't provide reliable silent message delivery for session creation/compaction events.

### ⚠️ System Prompt Injection (Formerly Used)

**Why replaced**: The plugin previously appended rules to the system prompt via `experimental.chat.system.transform`. Mutating the system prefix invalidated provider prompt caching for the whole conversation history, so it was replaced by persisted synthetic-part delivery.

### ✅ Persisted Synthetic Parts (Current)

**Advantages**:

- Initial durable delivery via the standard `chat.message` hook; mid-session file-family matches are admitted earlier through a no-reply `session.prompt` call
- Synthetic parts are hidden in the TUI but included in provider requests
- System prompt stays byte-stable across requests, preserving provider prompt caching
- Path-derived identity keys prevent re-appending durable rules already delivered in the session
- Compaction rebuilds durable delivery identities from surviving synthetic delivery metadata and missing durable rules are re-appended; ephemeral rules (agent, model, branch, tools) are recomputed per request and never persisted

### ❌ Naive Per-message Injection

**Why not**: Appending rule text to every message without deduplication would duplicate rules, wasting context tokens. Synthetic-part delivery avoids this with path-derived identity keys.

### ❌ Config-based Approach

**Why not**: Would persist rules to config file, affecting all users/projects globally.

### ✅ Working-Set Context Injection (Current, complementary)

Persisted synthetic parts handle rule _delivery_, while working-set context injection preserves file _paths_ through compaction — the two mechanisms coexist.

**Advantages**:

- Injected directly into OpenCode's compaction hook - no workarounds needed
- Efficient: Only current Working context (max 20 paths), not full rules
- Safe: Paths sanitized to prevent prompt injection
- Clean: Works within official plugin API
- Reliable: No timing dependencies or missing event handling
