## Why

Currently, rule discovery only finds files directly in the rules directories (`~/.config/opencode/rules/` and `.opencode/rules/`). Files in subdirectories are not discovered. This limits organizational flexibility - users cannot group related rules into folders (e.g., `frontend/`, `backend/`, `testing/`) for better maintainability.

## What Changes

- Modify `discoverRuleFiles()` to recursively scan subdirectories within rules directories
- Discover all `.md` and `.mdc` files at any depth within the rules directories
- Continue to skip hidden files and directories (those starting with `.`)
- Update debug logging to show the relative path from the rules directory

## Impact

- Affected specs: `rule-discovery`
- Affected code: `src/utils.ts` (discoverRuleFiles function)
- Backward compatible: Existing flat rule structures continue to work unchanged
