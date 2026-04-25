/**
 * Stable public API surface for OpenCode Rules Plugin.
 *
 * This barrel file intentionally re-exports the subset of modules
 * that external consumers (plugins, TUI, tests) should depend on.
 * It isolates consumers from internal module restructuring and
 * provides a single import point for the plugin's public surface.
 *
 * Re-exported modules:
 * - rule-discovery.ts: File discovery and caching
 * - rule-metadata.ts: Frontmatter parsing
 * - rule-filter.ts: Rule filtering and formatting
 * - message-paths.ts: Message path extraction
 * - rule-hooks.ts: Hook evaluation and serialization
 */

// Re-export from rule-discovery
export {
  discoverRuleFiles,
  clearRuleCache,
  type DiscoveredRule,
} from './rule-discovery.js';

// Re-export from rule-metadata
export { parseRuleMetadata, hasConditions } from './rule-metadata.js';

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

// Re-export from rule-hooks
export {
  evaluateHooks,
  serializeToolArgs,
  type HookEvaluationContext,
} from './rule-hooks.js';
