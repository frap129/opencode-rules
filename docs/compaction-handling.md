# Session Compaction Handling

## Problem

When OpenCode compacts a session (summarizes conversation history to manage context windows), custom rules could be lost from the AI's context. Additionally, file paths mentioned in tool calls may be lost in the summary, causing conditional rules that match those paths to stop applying.

## Solution

The plugin now uses two complementary approaches:

1. **Silent Messages** (legacy): Rules are sent via silent messages when sessions are created or compacted
2. **Working-Set Context Injection** (new): File paths currently in the working set are injected into the compaction summary, ensuring the compaction LLM includes them

## Implementation

### 1. Working-Set Context Injection (Task 6+)

When a session is compacted, the `experimental.session.compacting` hook injects the current file paths:

```typescript
'experimental.session.compacting': async (input, output) => {
  const sessionState = sessionStateMap.get(input.sessionID);
  const paths = Array.from(sessionState.contextPaths).sort();

  // Add minimal context string to output.context
  output.context.push(
    'OpenCode Rules: Working context\n' +
    'Current file paths in context:\n' +
    paths.slice(0, 20).map(p => `  - ${p}`).join('\n')
  );

  // Set flags for Task 7
  state.isCompacting = true;
  state.compactingSince = sessionStateTick;
};
```

**Why this works:**

- During compaction, OpenCode calls the `experimental.session.compacting` hook
- We extract the current working set (file paths the user was working with)
- We add a minimal context string that the compaction LLM includes in the summary
- This prevents conditional rules from becoming "invisible" when their matching paths are lost

**Benefits:**

- **Efficient**: Only injects the current working set (max 20 paths), not full rules
- **Deterministic**: Paths are sorted for consistent output
- **Scoped**: Separate from rule injection to keep compaction token usage low

### 2. Silent Message Function (Legacy)

Rules are also sent via silent messages to ensure full rule context:

```typescript
const sendRulesMessage = async (sessionID: string) => {
  await input.client.session.prompt({
    path: { id: sessionID },
    body: {
      noReply: true, // Silent message - no AI response
      parts: [{ type: 'text', text: formattedRules }],
    },
  });
};
```

### 3. Event Listeners

```typescript
event: async ({ event }) => {
  // Send rules when a new session is created
  if (event.type === 'session.created') {
    const sessionID = event.properties.info.id;
    if (!sessionsWithRules.has(sessionID)) {
      await sendRulesMessage(sessionID);
    }
  }

  // Re-send rules when a session is compacted
  if (event.type === 'session.compacted') {
    const sessionID = event.properties.sessionID;
    sessionsWithRules.delete(sessionID);
    await sendRulesMessage(sessionID);
  }
};
```

### 4. Session Tracking

The plugin maintains a `Set<string>` to track which sessions have already received rules:

- **On session.created**: Rules sent via silent message, session ID added to set
- **On session.compacted**: Session ID removed from set, rules re-sent immediately
- **Duplicate prevention**: Session ID checked before sending to avoid duplicates

### 5. Flow Diagram

```
Session Created
    ↓
Send Silent Message (rules) → Add to sessionsWithRules
Send Compacting Hook (working-set context)
    ↓
User sends messages...
    ↓
[Compaction Triggered]
    ↓
Working-Set Context Injected → Compaction LLM sees current files
Silent Message Re-sent → Remove from set, re-send rules
    ↓
User continues conversation...
```

## Why This Two-Pronged Approach

### Silent Messages (Full Rules)

- Ensures the AI has access to the complete rule set
- Sent immediately on session creation and after compaction
- No waiting for next user message

### Working-Set Context (Minimal Paths)

- Prevents file paths from disappearing during compaction
- Ensures conditional rules remain applicable after compaction
- Saves tokens by injecting only current paths, not full rules
- Allows compaction LLM to naturally include rule-matching paths

## Benefits

1. **Transparent**: No user configuration required
2. **Clean**: Silent messages don't clutter conversation with AI responses
3. **Efficient**: Rules only sent when needed; paths injected only during compaction
4. **Immediate**: Compaction triggers instant re-sending (no waiting for next user message)
5. **Reliable**: Uses OpenCode's built-in event system and message API
6. **Memory-safe**: Set-based tracking is memory-efficient
7. **Session-aware**: Handles multiple concurrent sessions correctly
8. **Conditional-rule-safe**: File paths persist through compaction summaries

## Testing

The implementation includes comprehensive tests:

```typescript
it('adds minimal working-set context during compaction', async () => {
  // Session state seeded with context paths
  __testOnly.upsertSessionState('ses_c', s => {
    s.contextPaths.add('src/components/Button.tsx');
    s.contextPaths.add('src/utils/helpers.ts');
  });

  // Call the compacting hook
  const compacting = hooks['experimental.session.compacting'];
  const output = { context: [] as string[] };
  await compacting({ sessionID: 'ses_c' }, output);

  // Assert paths are in output
  expect(output.context.join('\n')).toContain('src/components/Button.tsx');
});
```

## Event Types

The plugin uses event types from the OpenCode SDK:

```typescript
type EventSessionCreated = {
  type: 'session.created';
  properties: {
    info: Session; // Contains id, projectID, directory, etc.
  };
};

type EventSessionCompacted = {
  type: 'session.compacted';
  properties: {
    sessionID: string;
  };
};
```

## Logs

When running, you'll see these logs:

```
[opencode-rules] Sent rules to session ses_abc123
[opencode-rules] Added 5 context path(s) to compaction for session ses_abc123
[opencode-rules] Session ses_abc123 compacted - rules re-sent
```

## Alternative Approaches Considered

### ❌ System Prompt Injection

**Problem**: OpenCode plugin API doesn't expose system prompt modification hooks

### ❌ Config-based Approach

**Problem**: Would persist rules to config file, affecting all users/projects globally

### ❌ Per-message Injection

**Problem**: Would duplicate rules in every message, wasting context tokens

### ❌ User Message Modification (Previous Implementation)

**Problem**:

- Required waiting for user to send a message after compaction
- Rules appeared in user's message, not as separate context
- Timing-dependent (what if user doesn't send another message?)

### ✅ Silent Messages + Working-Set Context Injection (Current)

**Advantages**:

- Immediate: Rules sent instantly on session creation and compaction
- Clean: No AI responses clutter the conversation
- Transparent: Rules delivered as separate context items
- Efficient: Working-set context injected separately to save tokens
- Safe: Conditional rules remain applicable after compaction
- Reliable: Event-driven, not dependent on user actions
- Inspired by: [opencode-skills plugin](https://github.com/malhashemi/opencode-skills)
