# Refactor Plugin Implementation

## Why

The current implementation mixes rule validation utilities with plugin functionality, but the project's actual purpose is to be a simple plugin that discovers rule files and injects them into the system prompt. The code needs to be cleaned up to focus solely on this core functionality without unnecessary complexity.

## What Changes

- Remove rule validation engine and related utilities that are not part of the plugin's core purpose
- Simplify the plugin to focus only on file discovery and system prompt injection
- Clean up the codebase to remove unused RuleEngine interfaces and validation logic
- Ensure the plugin properly implements the OpenCode Plugin interface
- Maintain the existing file discovery behavior for XDG_CONFIG_HOME and project directories

## Impact

- Affected specs: rule-discovery (new spec focused on file discovery and injection)
- Affected code: src/index.ts (remove validation logic, simplify plugin structure)
- Simplified architecture focused on single responsibility: discover rules → inject into prompt
