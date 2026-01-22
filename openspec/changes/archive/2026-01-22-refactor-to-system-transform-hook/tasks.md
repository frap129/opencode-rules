## 1. Implementation

- [x] 1.1 Add `extractFilePathsFromMessages()` utility to `utils.ts`
  - Parse tool call arguments (read, edit, glob, grep results)
  - Regex scan message content for path-like strings
  - Return deduplicated array of file paths

- [x] 1.2 Refactor `index.ts` to use new hook architecture
  - Remove `event` hook and session tracking logic
  - Add `experimental.chat.messages.transform` hook for context gathering
  - Add `experimental.chat.system.transform` hook for rule injection
  - Store file context in module-level variable between hook calls

- [x] 1.3 Update rule filtering logic
  - Modify `readAndFormatRules()` to accept array of context file paths
  - Filter conditional rules (.mdc with globs) against all discovered paths

- [x] 1.4 Update debug logging
  - Log discovered file paths during context gathering
  - Log which rules are being injected

## 2. Testing

- [x] 2.1 Add unit tests for `extractFilePathsFromMessages()`
  - Test tool call argument parsing
  - Test regex path extraction from message content
  - Test deduplication

- [x] 2.2 Update existing tests for new architecture
  - Remove session tracking tests
  - Remove compaction handling tests
  - Add system transform hook tests

- [x] 2.3 Add integration test for conditional rules
  - Verify .mdc rules filter correctly based on message context

## 3. Documentation

- [x] 3.1 Update README with architecture notes
  - Document the two-hook approach
  - Note experimental API dependency
