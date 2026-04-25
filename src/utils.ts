/**
 * Stable public API surface for OpenCode Rules Plugin.
 *
 * This barrel file intentionally re-exports a focused subset of modules
 * that external consumers (plugins, TUI, tests) should depend on.
 * It isolates consumers from internal module restructuring and provides
 * a single import point for the plugin's public surface.
 *
 * Modules intentionally NOT re-exported (internal implementation):
 * - debug.ts: internal logging utilities
 * - message-context.ts: internal message helpers
 * - mcp-tools.ts: internal MCP integration
 * - runtime.ts: internal orchestration (entry point is index.ts)
 * - runtime-chat.ts: internal chat hook handler
 * - runtime-context.ts: internal filter context builder
 * - session-store.ts: internal session state
 *
 * Re-exported public modules:
 * - rule-discovery.ts: File discovery and caching
 * - rule-metadata.ts: Frontmatter parsing
 * - rule-filter.ts: Rule filtering and formatting
 * - message-paths.ts: Message path extraction
 * - rule-hooks.ts: Hook evaluation and serialization
 */

// Re-export from rule-discovery
export {
  discoverRuleFiles,
  getCachedRule,
  clearRuleCache,
  type DiscoveredRule,
} from './rule-discovery.js';

// Re-export from rule-metadata
export {
  parseRuleMetadata,
  hasConditions,
  type RuleMetadata,
} from './rule-metadata.js';

// Re-export from rule-filter
export {
  promptMatchesKeywords,
  toolsMatchAvailable,
  readAndFormatRules,
  type RuleFilterContext,
  type FilterResult,
} from './rule-filter.js';

// Re-export from message-paths
export {
  extractFilePathsFromMessages,
  type Message,
  type MessagePart,
} from './message-paths.js';

// Re-export from active-rules-state (needed by TUI and external consumers)
export { readActiveRulesState } from './active-rules-state.js';

// Re-export from rule-hooks
export {
  evaluateHooks,
  serializeToolArgs,
  type HookEvaluationContext,
} from './rule-hooks.js';
