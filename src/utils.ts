/**
 * Utility functions for OpenCode Rules Plugin
 *
 * This module serves as a compatibility facade that re-exports
 * from focused modules:
 * - rule-discovery.ts: File discovery and caching
 * - rule-metadata.ts: Frontmatter parsing
 * - rule-filter.ts: Rule filtering and formatting
 * - message-paths.ts: Message path extraction
 */

// Re-export from rule-discovery
export {
  discoverRuleFiles,
  clearRuleCache,
  type DiscoveredRule,
} from './rule-discovery.js';

// Re-export from rule-metadata (RuleMetadata is internal, not re-exported)
export { parseRuleMetadata } from './rule-metadata.js';

// Re-export from rule-filter
export {
  promptMatchesKeywords,
  toolsMatchAvailable,
  readAndFormatRules,
  type RuleFilterContext,
} from './rule-filter.js';

// Re-export from message-paths
export {
  extractFilePathsFromMessages,
  type Message,
  type MessagePart,
} from './message-paths.js';
