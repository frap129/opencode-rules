/**
 * Rule filtering and matching utilities
 */

import { minimatch } from 'minimatch';
import { createDebugLog } from './debug.js';
import { getCachedRule, type DiscoveredRule } from './rule-discovery.js';
import { hasConditions } from './rule-metadata.js';
import type { RuleMetadata } from './rule-metadata.js';

const debugLog = createDebugLog();

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
 * Returns an array of boolean match results (one per declared condition).
 */
function evaluateConditionChecks(
  metadata: RuleMetadata,
  context: RuleFilterContext,
  availableToolSet?: Set<string>
): boolean[] {
  const checks: boolean[] = [];

  if (metadata.globs) {
    checks.push(
      Boolean(
        context.contextFilePaths &&
        context.contextFilePaths.length > 0 &&
        context.contextFilePaths.some(contextPath =>
          fileMatchesGlobs(contextPath, metadata.globs!)
        )
      )
    );
  }

  if (metadata.keywords) {
    checks.push(
      Boolean(
        context.userPrompt &&
        promptMatchesKeywords(context.userPrompt, metadata.keywords)
      )
    );
  }

  if (metadata.tools) {
    checks.push(
      Boolean(
        availableToolSet &&
        metadata.tools.some(tool => availableToolSet.has(tool))
      )
    );
  }

  if (metadata.model) {
    checks.push(
      Boolean(context.modelID && metadata.model.includes(context.modelID))
    );
  }

  if (metadata.agent) {
    checks.push(
      Boolean(context.agentType && metadata.agent.includes(context.agentType))
    );
  }

  if (metadata.command) {
    checks.push(
      Boolean(context.command && metadata.command.includes(context.command))
    );
  }

  if (metadata.project) {
    const projectTags = context.projectTags;
    checks.push(
      Boolean(
        projectTags &&
        projectTags.length > 0 &&
        metadata.project.some(tag => projectTags.includes(tag))
      )
    );
  }

  if (metadata.branch) {
    const gitBranch = context.gitBranch;
    checks.push(
      Boolean(
        gitBranch &&
        metadata.branch.some(pattern => {
          if (pattern === gitBranch) return true;
          const hasGlobChars = /[*?\[{]/.test(pattern);
          if (hasGlobChars) {
            return minimatch(gitBranch, pattern);
          }
          return false;
        })
      )
    );
  }

  if (metadata.os) {
    checks.push(Boolean(context.os && metadata.os.includes(context.os)));
  }

  if (metadata.ci !== undefined) {
    checks.push(context.ci === metadata.ci);
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
 * Read and format rule files for system prompt injection
 * @param files - Array of discovered rule files with paths
 * @param context - Optional RuleFilterContext for conditional rule matching
 */
export async function readAndFormatRules(
  files: DiscoveredRule[],
  context: RuleFilterContext = {}
): Promise<FilterResult> {
  if (files.length === 0) {
    return { formattedRules: '', matchedPaths: [] };
  }

  const ruleContents: string[] = [];
  const matchedPaths: string[] = [];
  const availableToolSet =
    context.availableToolIDs && context.availableToolIDs.length > 0
      ? new Set(context.availableToolIDs)
      : undefined;

  for (const { filePath, relativePath } of files) {
    // Use cached rule data with mtime-based invalidation
    const cachedRule = await getCachedRule(filePath);
    if (!cachedRule) {
      continue; // Error already logged by getCachedRule
    }

    const { metadata, strippedContent } = cachedRule;

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
          ? declaredChecks.every(Boolean)
          : declaredChecks.some(Boolean);

      if (!shouldInclude) {
        debugLog(
          `Skipping conditional rule: ${relativePath} (match: ${mode}, checks: ${declaredChecks.join(', ')})`
        );
        continue;
      }

      debugLog(
        `Including conditional rule: ${relativePath} (match: ${mode}, checks: ${declaredChecks.join(', ')})`
      );
    }

    ruleContents.push(`## ${relativePath}\n\n${strippedContent}`);
    matchedPaths.push(filePath);
  }

  if (ruleContents.length === 0) {
    return { formattedRules: '', matchedPaths: [] };
  }

  return {
    formattedRules:
      `# OpenCode Rules\n\nPlease follow the following rules:\n\n` +
      ruleContents.join('\n\n---\n\n'),
    matchedPaths,
  };
}
