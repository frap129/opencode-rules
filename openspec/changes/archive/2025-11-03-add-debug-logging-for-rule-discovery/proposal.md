## Why

Users need visibility into which rule files are being discovered and loaded by the plugin to troubleshoot configuration issues and understand the rule discovery process.

## What Changes

- Add debug logging to list each rule file when discovered during the discovery process
- Log the source directory (global vs project) for each discovered file
- Maintain existing functionality while adding optional debug output

## Impact

- Affected specs: rule-discovery
- Affected code: src/utils.ts (discoverRuleFiles function)
