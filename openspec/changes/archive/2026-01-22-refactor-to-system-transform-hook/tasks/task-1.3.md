### Task 1.3: Update Rule Filtering Logic

**Files:**

- Modify: `src/utils.ts:154-196` (readAndFormatRules function)

**Context:**

Currently `readAndFormatRules` accepts an optional single `contextFilePath`. We need to update it to accept an array of paths and check if ANY path matches the rule's glob patterns.

---

**Step 1: Update the function signature and JSDoc**

Find in `src/utils.ts`:

```typescript
/**
 * Read and format rule files for system prompt injection
 * @param files - Array of rule file paths
 * @param contextFilePath - Optional path of the file being processed (used to filter rules by metadata)
 */
export async function readAndFormatRules(
  files: string[],
  contextFilePath?: string
): Promise<string> {
```

Replace with:

```typescript
/**
 * Read and format rule files for system prompt injection
 * @param files - Array of rule file paths
 * @param contextFilePaths - Optional array of file paths from conversation context (used to filter conditional rules)
 */
export async function readAndFormatRules(
  files: string[],
  contextFilePaths?: string[]
): Promise<string> {
```

**Step 2: Update the filtering logic**

Find the filtering logic inside the for loop (around line 174):

```typescript
// If metadata exists with globs and a context file path is provided,
// check if the context file matches any of the glob patterns
if (metadata && metadata.globs && contextFilePath) {
  if (!fileMatchesGlobs(contextFilePath, metadata.globs)) {
    // Rule does not apply to this file, skip it
    continue;
  }
}
```

Replace with:

```typescript
// If metadata exists with globs, check if any context path matches
if (metadata?.globs) {
  // If we have context paths, filter by them
  if (contextFilePaths && contextFilePaths.length > 0) {
    const anyMatch = contextFilePaths.some(contextPath =>
      fileMatchesGlobs(contextPath, metadata.globs!)
    );
    if (!anyMatch) {
      // Rule does not apply to any file in context, skip it
      console.debug(
        `[opencode-rules] Skipping conditional rule: ${filename} (no matching paths)`
      );
      continue;
    }
    console.debug(`[opencode-rules] Including conditional rule: ${filename}`);
  }
  // If no context paths provided, include the rule (backward compatibility)
}
```

**Step 3: Run type check**

Run: `npm run build`
Expected: PASS - no TypeScript errors

**Step 4: Run existing tests to check for regressions**

Run: `npm test`
Expected: Some tests may fail due to signature change - we'll fix those in Task 2.2

**Step 5: Commit**

```bash
git add src/utils.ts
git commit -m "feat: update rule filtering to support multiple context paths"
```
