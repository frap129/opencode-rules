# Implementation Tasks

## 1. Core Implementation

- [x] 1.1 Replace `chat.params` hook with `chat.message` hook in `src/index.ts`
- [x] 1.2 Implement logic to detect first message in a session
- [x] 1.3 Append formatted rules to the text content of the first message part
- [x] 1.4 Handle edge cases (empty messages, non-text parts, etc.)

## 2. Testing

- [x] 2.1 Update existing tests to validate `chat.message` hook instead of `chat.params`
- [x] 2.2 Add test for first message detection
- [x] 2.3 Add test for rule appending to message text
- [x] 2.4 Add test for subsequent messages (should not append rules)
- [x] 2.5 Verify all existing tests pass with new implementation

## 3. Validation

- [x] 3.1 Run `openspec validate refactor-rule-injection-to-message --strict`
- [x] 3.2 Manual testing with `opencode --print-logs --log-level DEBUG run` to verify message format
- [x] 3.3 Verify rules appear in first message of session
