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
  const paths = Array.from(sessionState.contextPaths).sort();

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

  // Set flags for potential future use
  state.isCompacting = true;
  state.compactingSince = Date.now();
};
```

**How it works:**

- During compaction, OpenCode calls the `experimental.session.compacting` hook
- We extract the current working set (file paths the user was working with)
- We add a minimal context string that the compaction LLM includes in the summary
- This prevents conditional rules from becoming "invisible" when their matching paths are lost

**Why this works:**

- **Efficient**: Only injects the current working set (max 20 paths), not full rules
- **Deterministic**: Paths are sorted for consistent output
- **Safe**: Paths are sanitized to prevent prompt injection via control characters
- **Minimal**: Separate from rule injection to keep compaction token usage low

### Incremental Context Capture

The plugin uses multiple hooks to incrementally build the working set:

1. **`tool.execute.before`**: Captures file paths from tool calls (read, edit, write, glob, grep)
2. **`experimental.chat.messages.transform`**: Seeds the working set from message history on first encounter
3. **`chat.message`**: Updates working set with latest user prompts

This multi-hook approach ensures:

- File paths are captured as soon as tools are used
- Session state persists across turns without rescanning
- No redundant message history scanning after the first turn

### Session State Persistence

Per-session state is stored in `sessionStateMap` with the following structure:

```typescript
interface SessionState {
  contextPaths: Set<string>; // Current working set of file paths
  lastUserPrompt?: string; // Latest user message text
  lastUpdated: number; // Timestamp for LRU cache pruning
  isCompacting?: boolean; // Flag: compaction in progress
  compactingSince?: number; // Timestamp when compaction started
  seededFromHistory: boolean; // Flag: history has been scanned
  seedCount?: number; // Count of history scans
}
```

- Maximum of 100 concurrent sessions in memory (LRU eviction)
- Each entry is tagged with `lastUpdated` for age tracking
- Sessions are automatically pruned when limit is exceeded

## Data Flow

### Normal Turn

```
User sends message
    ↓
chat.message hook captures file paths from message text
    ↓
tool.execute.before hooks capture paths from tool calls
    ↓
system.transform reads session state and injects applicable rules
    ↓
AI processes request with full context
```

### On Compaction

```
OpenCode triggers compaction (context window management)
    ↓
experimental.session.compacting hook runs
    ↓
Current working set (20 most recent file paths) injected into compaction context
    ↓
Compaction LLM generates summary including injected file paths
    ↓
Session context preserved through compaction
    ↓
Conditional rules remain applicable in next turn
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
    s.contextPaths.add('src/components/Button.tsx');
    s.contextPaths.add('src/utils/helpers.ts');
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
      s.contextPaths.add(`path/to/file${i}.ts`);
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
[opencode-rules] Recorded context path from tool read: src/components/Button.tsx
[opencode-rules] Seeded 5 context path(s) for session ses_abc123
[opencode-rules] Updated lastUserPrompt for session ses_abc123 (len=42, parts=1)
[opencode-rules] Added 20 context path(s) to compaction for session ses_abc123
```

## Alternative Approaches Considered

### ❌ Silent Messages (Legacy)

**Why not**: OpenCode plugin API doesn't provide reliable silent message delivery for session creation/compaction events.

### ❌ System Prompt Injection

**Why not**: No plugin hooks expose system prompt modification.

### ❌ Per-message Injection

**Why not**: Would duplicate rules in every message, wasting context tokens.

### ❌ Config-based Approach

**Why not**: Would persist rules to config file, affecting all users/projects globally.

### ✅ Working-Set Context Injection (Current)

**Advantages**:

- Injected directly into OpenCode's compaction hook - no workarounds needed
- Efficient: Only current working set (max 20 paths), not full rules
- Safe: Paths sanitized to prevent prompt injection
- Clean: Works within official plugin API
- Reliable: No timing dependencies or missing event handling
