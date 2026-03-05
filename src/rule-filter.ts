/**
 * Rule filtering and matching utilities
 */

import { minimatch } from 'minimatch';
import { createDebugLog } from './debug.js';
import { getCachedRule, type DiscoveredRule } from './rule-discovery.js';

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

/**
 * Check if any of the required tools are available.
 * Uses exact string matching (OR logic: any match returns true).
 *
 * @param availableToolIDs - Array of tool IDs currently available
 * @param requiredTools - Array of tool IDs from rule metadata
 * @returns true if any required tool is available
 */
export function toolsMatchAvailable(
  availableToolIDs: string[],
  requiredTools: string[]
): boolean {
  if (requiredTools.length === 0) {
    return false;
  }
  // Create a Set for O(1) lookups
  const availableSet = new Set(availableToolIDs);
  return requiredTools.some(tool => availableSet.has(tool));
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
): Promise<string> {
  if (files.length === 0) {
    return '';
  }

  const ruleContents: string[] = [];
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

    // Check if rule has any conditional filters
    const hasConditions = Boolean(
      metadata?.globs ||
      metadata?.keywords ||
      metadata?.tools ||
      metadata?.model ||
      metadata?.agent ||
      metadata?.command ||
      metadata?.project ||
      metadata?.branch ||
      metadata?.os ||
      metadata?.ci !== undefined
    );

    if (hasConditions && metadata) {
      // Compute per-dimension match booleans (only for declared conditions)
      const declaredChecks: boolean[] = [];

      // Legacy: globs
      if (metadata.globs) {
        const globs = metadata.globs;
        const globsMatch =
          context.contextFilePaths &&
          context.contextFilePaths.length > 0 &&
          context.contextFilePaths.some(contextPath =>
            fileMatchesGlobs(contextPath, globs)
          );
        declaredChecks.push(Boolean(globsMatch));
      }

      // Legacy: keywords
      if (metadata.keywords) {
        const keywordsMatch =
          context.userPrompt &&
          promptMatchesKeywords(context.userPrompt, metadata.keywords);
        declaredChecks.push(Boolean(keywordsMatch));
      }

      // Legacy: tools
      if (metadata.tools) {
        const toolsMatch =
          availableToolSet &&
          metadata.tools.some(tool => availableToolSet.has(tool));
        declaredChecks.push(Boolean(toolsMatch));
      }

      // New: model
      if (metadata.model) {
        const modelMatch =
          context.modelID && metadata.model.includes(context.modelID);
        declaredChecks.push(Boolean(modelMatch));
      }

      // New: agent
      if (metadata.agent) {
        const agentMatch =
          context.agentType && metadata.agent.includes(context.agentType);
        declaredChecks.push(Boolean(agentMatch));
      }

      // New: command
      if (metadata.command) {
        const commandMatch =
          context.command && metadata.command.includes(context.command);
        declaredChecks.push(Boolean(commandMatch));
      }

      // New: project
      if (metadata.project) {
        const projectTags = context.projectTags;
        const projectMatch =
          projectTags &&
          projectTags.length > 0 &&
          metadata.project.some(tag => projectTags.includes(tag));
        declaredChecks.push(Boolean(projectMatch));
      }

      // New: branch (supports glob patterns)
      if (metadata.branch) {
        const gitBranch = context.gitBranch;
        const branchMatch =
          gitBranch &&
          metadata.branch.some(pattern => {
            // Exact match for non-glob patterns
            if (pattern === gitBranch) {
              return true;
            }
            // Only use glob matching if pattern contains glob characters
            const hasGlobChars = /[*?\[{]/.test(pattern);
            if (hasGlobChars) {
              return minimatch(gitBranch, pattern);
            }
            return false;
          });
        declaredChecks.push(Boolean(branchMatch));
      }

      // New: os
      if (metadata.os) {
        const osMatch = context.os && metadata.os.includes(context.os);
        declaredChecks.push(Boolean(osMatch));
      }

      // New: ci (strict boolean equality)
      if (metadata.ci !== undefined) {
        const ciMatch = context.ci === metadata.ci;
        declaredChecks.push(ciMatch);
      }

      // Apply combinator: default 'any', or 'all' if specified
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

    // Use cached stripped content for output
    // Use relativePath for unique headings instead of just filename
    ruleContents.push(`## ${relativePath}\n\n${strippedContent}`);
  }

  if (ruleContents.length === 0) {
    return '';
  }

  return (
    `# OpenCode Rules\n\nPlease follow the following rules:\n\n` +
    ruleContents.join('\n\n---\n\n')
  );
}
