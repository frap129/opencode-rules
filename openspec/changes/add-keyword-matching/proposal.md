## Why

Currently, rules can only be conditionally applied based on file glob patterns. This limits the ability to apply rules based on the task context (e.g., "testing", "refactoring", "documentation"). Users want lightweight semantic matching without full AI description parsing (which is handled by OpenCode's "skills" feature).

## What Changes

- Add `keywords` field to rule frontmatter for semantic-lite matching
- Match keywords against user's latest prompt using word-boundary regex
- Use OR logic: rule applies if keywords match OR globs match
- Case-insensitive, word-boundary matching (e.g., "test" matches "testing")

## Impact

- Affected specs: `rule-discovery`
- Affected code: `src/utils.ts` (RuleMetadata interface, parseRuleMetadata, readAndFormatRules), `src/index.ts` (pass user prompt to rule filtering)
