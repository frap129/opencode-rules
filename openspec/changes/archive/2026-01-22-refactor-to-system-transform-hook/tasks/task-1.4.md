### Task 1.4: Update Debug Logging

**Files:**

- Modify: `src/index.ts` (already has logging from Task 1.2)
- Modify: `src/utils.ts` (already has logging from Task 1.3)

**Context:**

Most debug logging was added in Tasks 1.2 and 1.3. This task verifies the logging is complete and adds any missing log statements per the spec requirements:

- Log discovered file paths during context gathering
- Log which rules are being injected
- Log number of context file paths discovered

---

**Step 1: Verify logging in index.ts**

Check that `src/index.ts` contains these log statements (added in Task 1.2):

```typescript
// In plugin initialization:
console.debug(`[opencode-rules] Discovered ${ruleFiles.length} rule file(s)`);

// In messages.transform hook:
console.debug(
  `[opencode-rules] Extracted ${currentContextPaths.length} context path(s) from messages`
);

// In system.transform hook:
console.debug('[opencode-rules] Injecting rules into system prompt');
console.debug('[opencode-rules] No applicable rules for current context');
```

**Step 2: Add detailed path logging (optional enhancement)**

If you want more detailed logging, add to `experimental.chat.messages.transform` in `src/index.ts`:

Find:

```typescript
console.debug(
  `[opencode-rules] Extracted ${currentContextPaths.length} context path(s) from messages`
);
```

Replace with:

```typescript
if (currentContextPaths.length > 0) {
  console.debug(
    `[opencode-rules] Extracted ${currentContextPaths.length} context path(s): ${currentContextPaths.slice(0, 5).join(', ')}${currentContextPaths.length > 5 ? '...' : ''}`
  );
} else {
  console.debug('[opencode-rules] No file paths found in messages');
}
```

**Step 3: Verify logging in utils.ts**

Check that `src/utils.ts` contains these log statements:

```typescript
// In discoverRuleFiles (already exists):
console.debug(
  `[opencode-rules] Discovered global rule: ${entry} (${filePath})`
);
console.debug(
  `[opencode-rules] Discovered project rule: ${entry} (${filePath})`
);

// In readAndFormatRules (added in Task 1.3):
console.debug(
  `[opencode-rules] Skipping conditional rule: ${filename} (no matching paths)`
);
console.debug(`[opencode-rules] Including conditional rule: ${filename}`);
```

**Step 4: Run build to verify no syntax errors**

Run: `npm run build`
Expected: PASS

**Step 5: Commit (if any changes made)**

```bash
git add src/index.ts src/utils.ts
git commit -m "docs: enhance debug logging for rule injection"
```

If no changes were needed (all logging already added in previous tasks):

```bash
echo "No changes needed - logging already complete from Tasks 1.2 and 1.3"
```
