export {
  discoverRuleFiles,
  getCachedRule,
  clearRuleCache,
  type DiscoveredRule,
} from './rule-discovery.js';

export {
  parseRuleMetadata,
  hasConditions,
  type RuleMetadata,
} from './rule-metadata.js';

export {
  promptMatchesKeywords,
  toolsMatchAvailable,
  type RuleMatchContext,
} from './rule-filter.js';

export {
  extractFilePathsFromMessages,
  type Message,
  type MessagePart,
} from './message-paths.js';

// Needed by the TUI, which imports this facade instead of internal modules.
export { readMatchedRulesState } from './matched-rules-state.js';

export {
  evaluateHooks,
  serializeToolArgs,
  type HookEvaluationContext,
} from './rule-hooks.js';
