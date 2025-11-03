# Session Compaction Handling

## Problem

When OpenCode compacts a session (summarizes conversation history to manage context windows), custom rules could be lost from the AI's context. This would mean the AI agent loses access to your guidelines during long conversations.

## Solution

The plugin uses **silent messages** (the `noReply` pattern) to send rules when sessions are created or compacted, ensuring rules are always present in the AI's context without cluttering the conversation with AI responses.

## Implementation

### 1. Silent Message Function

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

### 2. Event Listeners

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

### 3. Session Tracking

The plugin maintains a `Set<string>` to track which sessions have already received rules:

- **On session.created**: Rules sent via silent message, session ID added to set
- **On session.compacted**: Session ID removed from set, rules re-sent immediately
- **Duplicate prevention**: Session ID checked before sending to avoid duplicates

### 4. Flow Diagram

```
Session Created Event
    ↓
Send Silent Message → Add to sessionsWithRules
    ↓
User sends messages...
    ↓
[Compaction Event] → Remove from sessionsWithRules
    ↓
Send Silent Message → Add to sessionsWithRules
    ↓
User continues conversation...
```

### 2. Session Tracking

The plugin maintains a `Set<string>` to track which sessions have already received rules:

- **On first message**: Rules are injected, session ID added to set
- **On subsequent messages**: Session ID found in set, skip injection
- **On compaction event**: Session ID removed from set
- **On next message after compaction**: Session ID not in set, rules re-injected

### 3. Flow Diagram

```
Session Start
    ↓
First Message → Inject Rules → Add to sessionsWithRules
    ↓
Message 2 → Skip (in sessionsWithRules)
    ↓
Message 3 → Skip (in sessionsWithRules)
    ↓
[Compaction Event] → Remove from sessionsWithRules
    ↓
Message 4 → Inject Rules → Add to sessionsWithRules
    ↓
Message 5 → Skip (in sessionsWithRules)
```

## Benefits

1. **Transparent**: No user configuration required
2. **Clean**: Silent messages don't clutter conversation with AI responses
3. **Efficient**: Rules only sent when needed (session creation + compaction)
4. **Immediate**: Compaction triggers instant re-sending (no waiting for next user message)
5. **Reliable**: Uses OpenCode's built-in event system and message API
6. **Memory-safe**: Set-based tracking is memory-efficient
7. **Session-aware**: Handles multiple concurrent sessions correctly

## Testing

The implementation includes comprehensive tests:

```typescript
it('should re-send rules after session compaction', async () => {
  // Session created - rules sent (call 1)
  expect(mockPrompt).toHaveBeenCalledTimes(1);

  // Session compacted - rules re-sent (call 2)
  await hooks.event({ type: 'session.compacted', ... });
  expect(mockPrompt).toHaveBeenCalledTimes(2);
});

it('should send silent message with rules on session.created event', async () => {
  await hooks.event({ type: 'session.created', ... });

  expect(mockPrompt).toHaveBeenCalledWith({
    path: { id: 'ses_456' },
    body: {
      noReply: true,
      parts: [{ type: 'text', text: expect.stringContaining('OpenCode Rules') }],
    },
  });
});
```

## Event Types

The plugin uses two event types from the OpenCode SDK:

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
[opencode-rules] Sent rules to session ses_abc123
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

### ✅ Silent Messages with Event Handling (Current)

**Advantages**:

- Immediate: Rules sent instantly on session creation and compaction
- Clean: No AI responses clutter the conversation
- Transparent: Rules delivered as separate context items
- Reliable: Event-driven, not dependent on user actions
- Inspired by: [opencode-skills plugin](https://github.com/malhashemi/opencode-skills)
