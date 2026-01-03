## Why

OpenCode now provides `experimental.chat.system.transform` and `experimental.chat.messages.transform` hooks for directly modifying the system prompt and inspecting messages before LLM calls. The current implementation uses `event` hooks with `client.session.prompt()` to inject rules as silent messages, which requires manual session tracking and compaction handling. The new hooks offer a cleaner, more reliable approach where rules are injected directly into the system prompt.

## What Changes

- **BREAKING**: Replace silent message injection with system prompt injection
  - Rules no longer appear as messages in conversation history
  - Rules are now part of the system prompt (invisible to user)
- Replace `event` hook + `client.session.prompt()` with `experimental.chat.system.transform`
- Add `experimental.chat.messages.transform` to gather file context for conditional rules
- Remove session tracking (`Set<string>`) - no longer needed
- Remove compaction handling - system prompt is rebuilt automatically each LLM call
- Add file path extraction utilities for conditional rule matching

## Impact

- Affected specs: `rule-discovery`
- Affected code: `src/index.ts` (major rewrite), `src/utils.ts` (add file path extraction)
- Breaking change: Rules move from conversation messages to system prompt
- Dependency: Requires OpenCode version with `experimental.chat.system.transform` hook
