import { extractSlashCommand } from './message-context.js';
import { detectProjectTags } from './project-fingerprint.js';
import { getGitBranch } from './git-branch.js';
import type { RuleFilterContext } from './rule-filter.js';
import type { DebugLog } from './debug.js';

export interface BuildFilterContextOptions {
  contextFilePaths: string[];
  userPrompt: string | undefined;
  availableToolIDs: string[];
  modelID: string | undefined;
  agentType: string | undefined;
}

/**
 * Parse an env variable value semantically: 'false', '0', '' => false; other non-empty => true.
 * Returns undefined if the variable is not set.
 */
function parseEnvBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === '') return false;
  const lower = value.toLowerCase();
  if (lower === 'false' || lower === '0') return false;
  return true;
}

/**
 * Check if a string value represents a truthy CI environment variable.
 * Treats 'false', '0', and empty strings as falsy; other non-empty values as truthy.
 */
function isTruthyEnvValue(value: string | undefined): boolean {
  return parseEnvBoolean(value) === true;
}

/**
 * Detect if running in a CI environment by checking common CI environment variables.
 *
 * If process.env.CI is explicitly set, it is treated as authoritative:
 * - CI='false' or CI='0' or CI='' => return false (no provider var fallback)
 * - CI='true' or CI='1' or any truthy value => return true
 *
 * If process.env.CI is not set (undefined), fall back to provider-specific detection.
 */
export function detectCiEnvironment(): boolean {
  const env = process.env;

  const ciExplicit = parseEnvBoolean(env.CI);
  if (ciExplicit !== undefined) {
    return ciExplicit;
  }

  return (
    isTruthyEnvValue(env.CONTINUOUS_INTEGRATION) ||
    isTruthyEnvValue(env.BUILD_NUMBER) ||
    isTruthyEnvValue(env.GITHUB_ACTIONS) ||
    isTruthyEnvValue(env.GITLAB_CI) ||
    isTruthyEnvValue(env.CIRCLECI) ||
    isTruthyEnvValue(env.TRAVIS) ||
    isTruthyEnvValue(env.JENKINS_URL) ||
    isTruthyEnvValue(env.BUILDKITE) ||
    isTruthyEnvValue(env.TEAMCITY_VERSION)
  );
}

/**
 * Build the filter context object used for rule matching.
 * Assembles runtime information from various sources.
 */
export async function buildFilterContext(
  opts: BuildFilterContextOptions,
  projectDirectory: string,
  debugLog: DebugLog
): Promise<RuleFilterContext> {
  const { contextFilePaths, userPrompt, availableToolIDs, modelID, agentType } =
    opts;

  const command = extractSlashCommand(userPrompt);

  let projectTags: string[] | undefined;
  try {
    projectTags = await detectProjectTags(projectDirectory);
    if (projectTags.length === 0) {
      projectTags = undefined;
    }
  } catch {
    projectTags = undefined;
  }

  let gitBranch: string | undefined;
  try {
    gitBranch = await getGitBranch(projectDirectory);
  } catch {
    gitBranch = undefined;
  }

  const os = process.platform;
  const ci = detectCiEnvironment();

  const context: RuleFilterContext = {
    os,
    ci,
  };

  if (contextFilePaths.length > 0) {
    context.contextFilePaths = contextFilePaths;
  }
  if (userPrompt !== undefined) {
    context.userPrompt = userPrompt;
  }
  if (availableToolIDs.length > 0) {
    context.availableToolIDs = availableToolIDs;
  }
  if (modelID !== undefined) {
    context.modelID = modelID;
  }
  if (agentType !== undefined) {
    context.agentType = agentType;
  }
  if (command !== undefined) {
    context.command = command;
  }
  if (projectTags !== undefined) {
    context.projectTags = projectTags;
  }
  if (gitBranch !== undefined) {
    context.gitBranch = gitBranch;
  }

  debugLog(
    `Filter context: model=${modelID ?? 'none'}, agent=${agentType ?? 'none'}, ` +
      `command=${command ?? 'none'}, branch=${gitBranch ?? 'none'}, ` +
      `os=${os}, ci=${ci}, projectTags=${projectTags?.join(',') ?? 'none'}`
  );

  return context;
}
