# Implementation Tasks

## 1. Core Implementation

- [x] 1.1 Remove `chat.message` hook from plugin
- [x] 1.2 Add `event` hook to listen for session events
- [x] 1.3 Implement `sendRulesMessage()` function using `client.session.prompt()` with `noReply: true`
- [x] 1.4 Handle `session.created` event to send rules on new sessions
- [x] 1.5 Handle `session.compacted` event to re-send rules after compaction
- [x] 1.6 Update session tracking to work with event-driven approach

## 2. Testing

- [x] 2.1 Update test mocks to provide `client.session.prompt` method
- [x] 2.2 Rewrite "prepend rules to first message" test as "send silent message on session.created"
- [x] 2.3 Update compaction test to verify immediate re-sending
- [x] 2.4 Add test for duplicate prevention on session.created
- [x] 2.5 Add test for multiple different sessions
- [x] 2.6 Add test for unknown session compaction handling
- [x] 2.7 Verify all 33 tests pass

## 3. Documentation

- [x] 3.1 Update README.md "How It Works" section
- [x] 3.2 Update README.md to document silent message pattern
- [x] 3.3 Update README.md "Session Compaction Support" section
- [x] 3.4 Update docs/compaction-handling.md with new implementation
- [x] 3.5 Create docs/silent-message-implementation.md migration guide
- [x] 3.6 Update openspec specifications to reflect changes

## 4. Build & Verification

- [x] 4.1 Run TypeScript compilation
- [x] 4.2 Run test suite
- [x] 4.3 Verify build output in dist/
- [x] 4.4 Manual testing in OpenCode environment (if applicable)
