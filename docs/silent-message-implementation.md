# Silent Message Implementation

## Overview

The plugin has been updated to use OpenCode's **silent message pattern** (the `noReply` flag) to inject rules into sessions. This approach is cleaner, more reliable, and immediately responsive to session events.

## What Changed

### Before: User Message Injection

```typescript
'chat.message': async (_hookInput, output) => {
  // Inject rules into the first user message
  const textPart = output.parts.find(part => part.type === 'text');
  textPart.text = formattedRules + '\n\n' + textPart.text;
}
```

**Problems**:

- Rules embedded in user's message
- Compaction required waiting for next user message
- Timing-dependent behavior
- Cluttered user message content

### After: Silent Messages with Events

```typescript
event: async ({ event }) => {
  if (event.type === 'session.created') {
    // Send rules immediately when session is created
    await client.session.prompt({
      path: { id: sessionID },
      body: {
        noReply: true, // Silent - no AI response
        parts: [{ type: 'text', text: formattedRules }],
      },
    });
  }

  if (event.type === 'session.compacted') {
    // Re-send rules immediately when compacted
    await sendRulesMessage(sessionID);
  }
};
```

**Benefits**:

- ✅ Clean separation: Rules sent as independent messages
- ✅ Immediate: Responds instantly to events
- ✅ No AI chatter: `noReply: true` prevents unnecessary responses
- ✅ Event-driven: Works with OpenCode's event system
- ✅ User-invisible: Rules added transparently

## Implementation Details

### 1. Event Listeners

The plugin now listens for two key events:

#### `session.created`

```typescript
if (event.type === 'session.created') {
  const sessionID = event.properties.info.id;
  if (!sessionsWithRules.has(sessionID)) {
    await sendRulesMessage(sessionID);
  }
}
```

#### `session.compacted`

```typescript
if (event.type === 'session.compacted') {
  const sessionID = event.properties.sessionID;
  sessionsWithRules.delete(sessionID); // Reset tracking
  await sendRulesMessage(sessionID); // Re-send immediately
}
```

### 2. Silent Message Function

```typescript
const sendRulesMessage = async (sessionID: string) => {
  try {
    await input.client.session.prompt({
      path: { id: sessionID },
      body: {
        noReply: true, // Key: Prevents AI from responding
        parts: [{ type: 'text', text: formattedRules }],
      },
    });

    sessionsWithRules.add(sessionID);
    console.log(`[opencode-rules] Sent rules to session ${sessionID}`);
  } catch (error) {
    console.error(`[opencode-rules] Failed to send rules:`, error);
  }
};
```

### 3. Session Tracking

```typescript
// Track which sessions have received rules
const sessionsWithRules = new Set<string>();

// On creation: Add to set after sending
sessionsWithRules.add(sessionID);

// On compaction: Remove then re-add
sessionsWithRules.delete(sessionID);
await sendRulesMessage(sessionID); // Adds back to set
```

## Testing Updates

All tests were updated to verify the new behavior:

### Test: Session Creation

```typescript
it('should send silent message with rules on session.created event', async () => {
  await hooks.event({
    event: { type: 'session.created', properties: { info: { id: 'ses_123' } } },
  });

  expect(mockPrompt).toHaveBeenCalledWith({
    path: { id: 'ses_123' },
    body: {
      noReply: true,
      parts: [
        { type: 'text', text: expect.stringContaining('OpenCode Rules') },
      ],
    },
  });
});
```

### Test: Compaction

```typescript
it('should re-send rules after session compaction', async () => {
  // Session created
  await hooks.event({ type: 'session.created', ... });
  expect(mockPrompt).toHaveBeenCalledTimes(1);

  // Session compacted
  await hooks.event({ type: 'session.compacted', ... });
  expect(mockPrompt).toHaveBeenCalledTimes(2);  // Rules sent twice
});
```

### Test: Duplicate Prevention

```typescript
it('should not send rules twice to the same session', async () => {
  await hooks.event({
    type: 'session.created',
    properties: { info: { id: 'ses_123' } },
  });
  await hooks.event({
    type: 'session.created',
    properties: { info: { id: 'ses_123' } },
  });

  expect(mockPrompt).toHaveBeenCalledTimes(1); // Only once
});
```

## Migration Impact

### Breaking Changes

- **None**: Plugin API usage remains the same
- **Config**: No changes required
- **Rule files**: No changes required

### Behavioral Changes

- **When rules are sent**: Now on session creation, not first user message
- **Compaction**: Rules re-sent immediately, not on next message
- **Message structure**: Rules appear as separate context items, not in user messages

## Inspiration

This implementation is inspired by the [opencode-skills plugin](https://github.com/malhashemi/opencode-skills) by @malhashemi, which pioneered the silent message pattern for delivering skill content.

## Performance

### Advantages

- **Faster**: No waiting for user messages
- **Cleaner**: Separate context items in conversation
- **Reliable**: Event-driven, not dependent on user behavior

### Considerations

- **Network calls**: One additional API call per session (creation + compaction)
- **Error handling**: Wrapped in try/catch to handle API failures gracefully

## Future Enhancements

Possible improvements:

1. **Batch sending**: Combine multiple rule files into fewer messages
2. **Conditional sending**: Only send rules relevant to session context
3. **Rule updates**: Listen for file changes and update active sessions
4. **Compression**: Minify rule content to save tokens

## Conclusion

The silent message implementation provides a cleaner, more reliable way to inject rules into OpenCode sessions. It leverages OpenCode's native event system and message API to deliver rules transparently and efficiently.

**Result**: Rules are always present in the AI's context, without cluttering the conversation or depending on user behavior.
