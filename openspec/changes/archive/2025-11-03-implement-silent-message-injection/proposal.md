# Silent Message Injection Implementation

## Why

The previous implementation injected rules by modifying the first user message text, which had several issues:

- Rules embedded in user's message (not clean separation)
- Compaction required waiting for next user message (timing-dependent)
- Rules appeared as part of user input rather than separate context

The OpenCode SDK provides a `noReply` message pattern (silent messages) that allows sending context without triggering AI responses. This is a cleaner, more reliable approach used by other plugins like opencode-skills.

## What Changes

- **BREAKING**: Remove `chat.message` hook implementation
- Add `event` hook to listen for session lifecycle events
- Send rules via silent messages (`noReply: true`) on `session.created` events
- Re-send rules immediately on `session.compacted` events
- Use `client.session.prompt()` API instead of modifying user message parts
- Rules sent as separate context items, not embedded in user messages

## Impact

- Affected specs: `rule-discovery`
- Affected code: `src/index.ts` (main plugin implementation)
- Affected tests: All tests in `src/index.test.ts` updated to verify event-driven behavior
- Breaking change: Plugin behavior changes from message modification to event-driven message sending
- User-facing: No configuration changes required, behavior is transparent
