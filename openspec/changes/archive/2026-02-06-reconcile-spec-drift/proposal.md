# Proposal: reconcile-spec-drift

## Summary

Code changes were made to the opencode-rules plugin outside the openspec workflow, causing the `rule-discovery` spec to diverge from the current implementation. This proposal reconciles the spec against the codebase by adding requirements for new capabilities and modifying existing requirements whose behavior changed.

## Motivation

The following implementation features have no spec coverage:

- **Tool-based rule matching**: Rules can declare a `tools` frontmatter field; the plugin matches tool IDs (including MCP capabilities) against available tools using OR logic alongside globs and keywords.
- **MCP capability discovery**: The plugin queries connected MCP clients and synthesizes capability IDs (`mcp_<name>`) used in tool-based matching.
- **Real-time context capture**: Two additional hooks (`tool.execute.before`, `chat.message`) capture file paths and user prompts as they occur, supplementing the message-history seed.
- **Session compacting support**: The `experimental.session.compacting` hook marks sessions as compacting, skips rule injection during compaction (with TTL), and injects context paths into the compaction string.

The following existing spec requirements no longer match the code:

- **Session Context Lifecycle**: Spec describes delete-after-read; code uses a persistent LRU `SessionStore` with tick-based eviction.
- **Message Context Extraction**: Spec describes message-transform-only extraction; code uses multi-source extraction (history seed + real-time hooks) with a `seededFromHistory` flag.
- **System Prompt Rule Injection**: Code now skips injection during compaction and passes available tool IDs for tool-based matching.
- **Rule File Formats**: Missing `tools` frontmatter field and associated OR-logic scenarios.
- **Frontmatter Parsing**: Spec claims case-insensitive keys; code uses literal key access.
- **Debug Logging**: Spec says only `"true"` enables logging; code treats any truthy value as enabled.

## Scope

- Spec-only change; no code modifications required.
- All deltas target the `rule-discovery` capability.

## Risks

- None. This proposal documents existing behavior without changing it.
