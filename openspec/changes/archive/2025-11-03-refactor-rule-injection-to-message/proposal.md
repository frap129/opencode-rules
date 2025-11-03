# Refactor Rule Injection to Message

## Why

The current implementation uses the `chat.params` hook to inject rules via `systemPromptSuffix`, which adds rules to the system prompt options. This approach has limited visibility and control over when and how rules are included in conversations. By switching to the `chat.message` hook, rules can be appended directly to the first message of every session, providing clearer context and better integration with the message flow.

## What Changes

- **BREAKING**: Replace `chat.params` hook with `chat.message` hook for rule injection
- Append formatted rules to the first message text content instead of system prompt suffix
- Update all tests to validate message-based rule injection
- Ensure rules are only appended to the first user message in a session

## Impact

- **Affected specs**: rule-discovery (MODIFIED: how rules are injected into conversations)
- **Affected code**:
  - `src/index.ts` - Replace hook implementation
  - `src/index.test.ts` - Update test assertions and validation logic
- **Breaking change**: Plugins or systems relying on `systemPromptSuffix` will need to adapt
- **User-visible change**: Rules will appear as part of the first message rather than in system options
