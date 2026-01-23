## 1. Fix Test Infrastructure (Blocker)

- [x] 1.1 Add `serverUrl: new URL('http://localhost:3000')` to all mockInput objects in `src/index.test.ts` (~10 occurrences at lines 1581, 1616, 1653, 1689, 1724, 1763, 1806, 1880, 1958, 2030)
- [x] 1.2 Replace hardcoded `/tmp/opencode-rules-test` with `mkdtempSync(path.join(os.tmpdir(), 'opencode-rules-test-'))` in `setupTestDirs()`
- [x] 1.3 Verify tests pass with `npm run test:run`

## 2. Type Safety

- [x] 2.1 Define typed interfaces in `src/index.ts`:
  - `MessagePartWithSession` - part with `type`, `text`, `sessionID`, `synthetic`
  - `MessageWithInfo` - message structure with `info`, `parts`
  - `MessagesTransformOutput` - `{ messages: MessageWithInfo[] }`
  - `SystemTransformInput` - `{ sessionID?: string }`
  - `SystemTransformOutput` - `{ system?: string | string[] }`
- [x] 2.2 Replace `any` in `extractSessionID(messages: any[])` with `MessageWithInfo[]`
- [x] 2.3 Replace `any` in `extractLatestUserPrompt(messages: any[])` with `MessageWithInfo[]`
- [x] 2.4 Replace `any` in messages.transform output parameter with `MessagesTransformOutput`
- [x] 2.5 Replace `any` in system.transform output parameter with `SystemTransformOutput`
- [x] 2.6 Update hooks with proper return types
- [x] 2.7 Verify build passes with `npm run build`

## 3. Memory Management (Critical)

- [x] 3.1 Add `sessionContextMap.delete(sessionID)` after reading in `system.transform` hook
- [x] 3.2 Add comment documenting the delete-on-use lifecycle assumption
- [x] 3.3 Session cleanup is now implicit in the implementation
- [x] 3.4 Verify tests pass with `npm run test:run`

## 4. Error Handling

- [x] 4.1 Replace empty `catch {}` block in `scanDirectoryRecursively` with warning log
- [x] 4.2 Log format: `console.warn('[opencode-rules] Warning: Failed to read directory ${dir}: ${message}')`
- [x] 4.3 Error handling now provides visibility in logs

## 5. Debug Logging Control

- [x] 5.1 Add `OPENCODE_RULES_DEBUG` env var check at module level
- [x] 5.2 Create `function debugLog(message: string): void` helper
- [x] 5.3 Replace all `console.debug` calls with `debugLog()` wrapper
- [x] 5.4 Logged messages now use debugLog for conditional output
- [x] 5.5 Debug logging is disabled by default (requires env var)

## 6. YAML Parsing

- [x] 6.1 Add `yaml` to package.json dependencies
- [x] 6.2 Run `npm install` to install dependency
- [x] 6.3 Refactor `parseRuleMetadata` to use `parseYaml()` from yaml package
- [x] 6.4 YAML parsing now properly handles complex structures
- [x] 6.5 `stripFrontmatter()` continues to work independently
- [x] 6.6 YAML package handles case sensitivity correctly
- [x] 6.7 Added tests for inline array syntax `globs: ["*.ts"]`
- [x] 6.8 YAML package handles standard formats

## 7. Rule Heading Uniqueness

- [x] 7.1 Modify `discoverRuleFiles` to return `DiscoveredRule` with `filePath` and `relativePath`
- [x] 7.2 Format: `## relativePath` instead of `## filename` for unique headings
- [x] 7.3 Tests updated to use new `DiscoveredRule` type

## 8. Performance Caching

- [x] 8.1 Define `CachedRule` interface with `content`, `metadata`, `strippedContent`, `mtime`
- [x] 8.2 Add `ruleCache: Map<string, CachedRule>` at module level in `src/utils.ts`
- [x] 8.3 Add `getCachedRule()` function with mtime-based invalidation
- [x] 8.4 Use `statSync(path).mtimeMs` for cache invalidation
- [x] 8.5 Add `clearRuleCache()` export for testing
- [x] 8.6 Cache stores parsed metadata and stripped content
- [x] 8.7 Added tests for cache hit and invalidation behavior

## 9. Documentation

- [x] 9.1 Update README.md to describe Map-based session context with cleanup
- [x] 9.2 Remove/correct WeakMap claims
- [x] 9.3 Remove/correct async file operations claims
- [x] 9.4 Document `OPENCODE_RULES_DEBUG` environment variable
- [x] 9.5 Document performance features (caching, mtime invalidation)

## 10. Additional Test Coverage

- [x] 10.1 Added YAML parsing edge case tests (empty frontmatter, whitespace, complex structures)
- [x] 10.2 Added tests for inline YAML array syntax
- [x] 10.3 Added tests for non-string array element filtering
- [x] 10.4 Added cache functionality tests (hit, invalidation, clear)
- [x] 10.5 Run full test suite and verify all pass: `npm run test:run` - 94 tests passing

## Verification

- [x] All tests pass: `npm run test:run` (94 tests)
- [x] Build succeeds: `npm run build`
- [x] No TypeScript errors in source files
