/**
 * Rule filtering and matching utilities
 */

import { minimatch } from 'minimatch';
import { createDebugLog } from './debug.js';
import {
  loadRuleSnapshots,
  type DiscoveredRule,
  type RuleSnapshot,
} from './rule-discovery.js';
import { hasConditions } from './rule-metadata.js';
import type { RuleMetadata } from './rule-metadata.js';

const debugLog = createDebugLog();

/**
 * Delivery lifetime of a matched rule. Durable rules are persisted as
 * synthetic parts in session history; ephemeral rules are delivered only
 * as request-scoped transient messages.
 */
export type RuleLifetime = 'durable' | 'ephemeral';

/** The condition dimensions a rule can declare. */
export type RuleConditionKind =
  | 'globs'
  | 'keywords'
  | 'tools'
  | 'model'
  | 'agent'
  | 'command'
  | 'project'
  | 'branch'
  | 'os'
  | 'ci';

/** Result of evaluating a single declared condition. */
export interface ConditionEvaluation {
  kind: RuleConditionKind;
  matched: boolean;
  lifetime: RuleLifetime;
}

/** Session-durable condition kinds (everything except agent/model/branch/tools). */
const DURABLE_KINDS: ReadonlySet<RuleConditionKind> = new Set([
  'globs',
  'keywords',
  'command',
  'project',
  'os',
  'ci',
]);

function lifetimeForKind(kind: RuleConditionKind): RuleLifetime {
  return DURABLE_KINDS.has(kind) ? 'durable' : 'ephemeral';
}

/**
 * Classify the delivery lifetime of a matched rule from its condition
 * results. Unconditional rules are durable. `match: all` is ephemeral when
 * any required condition is ephemeral; `match: any` is durable when at
 * least one satisfied condition is durable.
 */
export function classifyRuleLifetime(
  mode: 'any' | 'all',
  results: readonly ConditionEvaluation[]
): RuleLifetime {
  if (results.length === 0) return 'durable';
  if (mode === 'all') {
    return results.some(result => result.lifetime === 'ephemeral')
      ? 'ephemeral'
      : 'durable';
  }
  return results.some(result => result.matched && result.lifetime === 'durable')
    ? 'durable'
    : 'ephemeral';
}

/**
 * Check if a file path matches any of the given glob patterns
 */
function fileMatchesGlobs(filePath: string, globs: string[]): boolean {
  return globs.some(glob => minimatch(filePath, glob, { matchBase: true }));
}

/**
 * Check if a user prompt matches any of the given keywords.
 * Uses case-insensitive word-boundary matching.
 *
 * @param prompt - The user's prompt text
 * @param keywords - Array of keywords to match
 * @returns true if any keyword matches the prompt
 */
export function promptMatchesKeywords(
  prompt: string,
  keywords: string[]
): boolean {
  const lowerPrompt = prompt.toLowerCase();

  return keywords.some(keyword => {
    const lowerKeyword = keyword.toLowerCase();
    // Escape special regex characters in the keyword
    const escaped = lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Word boundary at start, but allow continuation at end (e.g., "test" matches "testing")
    const regex = new RegExp(`\\b${escaped}`, 'i');
    return regex.test(lowerPrompt);
  });
}

/** Check if any required tool is in the available set. */
export function toolsMatchAvailable(
  availableToolIDs: string[],
  requiredTools: string[]
): boolean {
  const availableSet = new Set(availableToolIDs);
  return requiredTools.some(tool => availableSet.has(tool));
}

/**
 * Evaluate all declared condition checks for a rule against runtime context.
 * Returns one evaluation per declared condition with its kind and lifetime.
 */
function evaluateConditionChecks(
  metadata: RuleMetadata,
  context: RuleFilterContext,
  availableToolSet?: Set<string>
): ConditionEvaluation[] {
  const checks: ConditionEvaluation[] = [];

  if (metadata.globs) {
    checks.push({
      kind: 'globs',
      matched: Boolean(
        context.contextFilePaths &&
        context.contextFilePaths.length > 0 &&
        context.contextFilePaths.some(contextPath =>
          fileMatchesGlobs(contextPath, metadata.globs!)
        )
      ),
      lifetime: lifetimeForKind('globs'),
    });
  }

  if (metadata.keywords) {
    checks.push({
      kind: 'keywords',
      matched: Boolean(
        context.userPrompt &&
        promptMatchesKeywords(context.userPrompt, metadata.keywords)
      ),
      lifetime: lifetimeForKind('keywords'),
    });
  }

  if (metadata.tools) {
    checks.push({
      kind: 'tools',
      matched: Boolean(
        availableToolSet &&
        metadata.tools.some(tool => availableToolSet.has(tool))
      ),
      lifetime: lifetimeForKind('tools'),
    });
  }

  if (metadata.model) {
    checks.push({
      kind: 'model',
      matched: Boolean(
        context.modelID && metadata.model.includes(context.modelID)
      ),
      lifetime: lifetimeForKind('model'),
    });
  }

  if (metadata.agent) {
    checks.push({
      kind: 'agent',
      matched: Boolean(
        context.agentType && metadata.agent.includes(context.agentType)
      ),
      lifetime: lifetimeForKind('agent'),
    });
  }

  if (metadata.command) {
    checks.push({
      kind: 'command',
      matched: Boolean(
        context.command && metadata.command.includes(context.command)
      ),
      lifetime: lifetimeForKind('command'),
    });
  }

  if (metadata.project) {
    const projectTags = context.projectTags;
    checks.push({
      kind: 'project',
      matched: Boolean(
        projectTags &&
        projectTags.length > 0 &&
        metadata.project.some(tag => projectTags.includes(tag))
      ),
      lifetime: lifetimeForKind('project'),
    });
  }

  if (metadata.branch) {
    const gitBranch = context.gitBranch;
    checks.push({
      kind: 'branch',
      matched: Boolean(
        gitBranch &&
        metadata.branch.some(pattern => {
          if (pattern === gitBranch) return true;
          const hasGlobChars = /[*?\[{]/.test(pattern);
          if (hasGlobChars) {
            return minimatch(gitBranch, pattern);
          }
          return false;
        })
      ),
      lifetime: lifetimeForKind('branch'),
    });
  }

  if (metadata.os) {
    checks.push({
      kind: 'os',
      matched: Boolean(context.os && metadata.os.includes(context.os)),
      lifetime: lifetimeForKind('os'),
    });
  }

  if (metadata.ci !== undefined) {
    checks.push({
      kind: 'ci',
      matched: context.ci === metadata.ci,
      lifetime: lifetimeForKind('ci'),
    });
  }

  return checks;
}

/**
 * Result of reading and formatting rules
 */
export interface FilterResult {
  formattedRules: string;
  matchedPaths: string[];
}

/**
 * Runtime filter context for conditional rule matching
 */
export interface RuleFilterContext {
  /** File paths from conversation context (for glob matching) */
  contextFilePaths?: string[];
  /** User's prompt text (for keyword matching) */
  userPrompt?: string;
  /** Available tool IDs (for tool-based filtering) */
  availableToolIDs?: string[];
  /** Current model ID */
  modelID?: string;
  /** Current agent type */
  agentType?: string;
  /** Current slash command (e.g., /plan, /review) */
  command?: string;
  /** Detected project tags (e.g., node, python, monorepo) */
  projectTags?: string[];
  /** Current git branch name */
  gitBranch?: string;
  /** Current operating system (e.g., linux, darwin, win32) */
  os?: string;
  /** Whether running in CI environment */
  ci?: boolean;
}

/**
 * A single rule file that matched the runtime context
 */
export interface MatchedRuleEntry {
  /** Absolute path to the rule file */
  filePath: string;
  /** Relative path from the rules directory root */
  relativePath: string;
  /** Short display name from frontmatter or the file name without extension */
  name: string;
  /** Rule content with frontmatter stripped */
  strippedContent: string;
  /** Per-condition evaluation results with delivery-lifetime provenance */
  conditionResults: ConditionEvaluation[];
  /** Delivery lifetime classification for this evaluation */
  lifetime: RuleLifetime;
}

/**
 * Match already-loaded rule snapshots against the runtime context.
 * Performs no filesystem I/O. Unconditional rules are always included;
 * conditional rules are included when their declared checks pass
 * (match: any|all). Entry order follows snapshot order.
 *
 * @param snapshots - Per-session rule snapshots from loadRuleSnapshots
 * @param context - Optional RuleFilterContext for conditional rule matching
 */
export function matchRuleSnapshots(
  snapshots: readonly RuleSnapshot[],
  context: RuleFilterContext = {}
): MatchedRuleEntry[] {
  if (snapshots.length === 0) {
    return [];
  }

  const availableToolSet =
    context.availableToolIDs && context.availableToolIDs.length > 0
      ? new Set(context.availableToolIDs)
      : undefined;

  const matched: MatchedRuleEntry[] = [];

  for (const {
    filePath,
    relativePath,
    name,
    metadata,
    strippedContent,
  } of snapshots) {
    const ruleHasConditions = hasConditions(metadata);

    if (ruleHasConditions && metadata) {
      const declaredChecks = evaluateConditionChecks(
        metadata,
        context,
        availableToolSet
      );

      const mode = metadata.match ?? 'any';
      const shouldInclude =
        mode === 'all'
          ? declaredChecks.every(check => check.matched)
          : declaredChecks.some(check => check.matched);

      if (!shouldInclude) {
        debugLog(
          `Skipping conditional rule: ${relativePath} (match: ${mode}, checks: ${declaredChecks
            .map(check => `${check.kind}=${check.matched}`)
            .join(', ')})`
        );
        continue;
      }

      debugLog(
        `Including conditional rule: ${relativePath} (match: ${mode}, checks: ${declaredChecks
          .map(check => `${check.kind}=${check.matched}`)
          .join(', ')})`
      );

      matched.push({
        filePath,
        relativePath,
        name,
        strippedContent,
        conditionResults: declaredChecks,
        lifetime: classifyRuleLifetime(mode, declaredChecks),
      });
    } else {
      matched.push({
        filePath,
        relativePath,
        name,
        strippedContent,
        conditionResults: [],
        lifetime: 'durable',
      });
    }
  }

  return matched;
}

/**
 * Match discovered rule files against the runtime context.
 * Loads current rule data from disk (mtime-cached) for legacy one-shot
 * callers, then delegates to matchRuleSnapshots.
 * Unreadable rules are skipped. Entry order follows discovery order.
 *
 * @param files - Array of discovered rule files with paths
 * @param context - Optional RuleFilterContext for conditional rule matching
 */
export async function matchRules(
  files: DiscoveredRule[],
  context: RuleFilterContext = {}
): Promise<MatchedRuleEntry[]> {
  const snapshots = await loadRuleSnapshots(files);
  return matchRuleSnapshots(snapshots, context);
}

/**
 * Read and format rule files for system prompt injection
 * @param files - Array of discovered rule files with paths
 * @param context - Optional RuleFilterContext for conditional rule matching
 */
export async function readAndFormatRules(
  files: DiscoveredRule[],
  context: RuleFilterContext = {}
): Promise<FilterResult> {
  const matched = await matchRules(files, context);
  if (matched.length === 0) {
    return { formattedRules: '', matchedPaths: [] };
  }
  return {
    formattedRules:
      `# OpenCode Rules\n\nPlease follow the following rules:\n\n` +
      matched
        .map(m => `## ${m.relativePath}\n\n${m.strippedContent}`)
        .join('\n\n---\n\n'),
    matchedPaths: matched.map(m => m.filePath),
  };
}
