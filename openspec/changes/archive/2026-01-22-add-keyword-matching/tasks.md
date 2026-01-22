## 1. Implementation

- [x] 1.1 Add `keywords?: string[]` to `RuleMetadata` interface in `src/utils.ts`
- [x] 1.2 Update `parseRuleMetadata()` to extract keywords from YAML frontmatter
- [x] 1.3 Create `promptMatchesKeywords(prompt: string, keywords: string[]): boolean` function
- [x] 1.4 Update `readAndFormatRules()` signature to accept optional `userPrompt` parameter
- [x] 1.5 Implement OR logic in `readAndFormatRules()` for keywords and globs filtering
- [x] 1.6 Update `messages.transform` hook to extract user's latest prompt text
- [x] 1.7 Update `system.transform` hook to pass user prompt to `readAndFormatRules()`

## 2. Testing

- [x] 2.1 Add unit tests for `promptMatchesKeywords()` function
- [x] 2.2 Add unit tests for keyword parsing in `parseRuleMetadata()`
- [x] 2.3 Add integration tests for keyword-only rules
- [x] 2.4 Add integration tests for combined keywords + globs rules (OR logic)
- [x] 2.5 Add tests for case-insensitivity and word-boundary matching

## 3. Documentation

- [x] 3.1 Update README with keywords frontmatter example
- [x] 3.2 Update docs/rules.md with keywords usage
