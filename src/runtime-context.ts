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
  projectDirectory: string;
  debugLog: DebugLog;
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

/** Detect if running in a CI environment by checking common CI environment variables. */
export function detectCiEnvironment(): boolean {
  const env = process.env;

  const ciExplicit = parseEnvBoolean(env.CI);
  if (ciExplicit !== undefined) {
    return ciExplicit;
  }

  return (
    parseEnvBoolean(env.CONTINUOUS_INTEGRATION) === true ||
    parseEnvBoolean(env.BUILD_NUMBER) === true ||
    parseEnvBoolean(env.GITHUB_ACTIONS) === true ||
    parseEnvBoolean(env.GITLAB_CI) === true ||
    parseEnvBoolean(env.CIRCLECI) === true ||
    parseEnvBoolean(env.TRAVIS) === true ||
    parseEnvBoolean(env.JENKINS_URL) === true ||
    parseEnvBoolean(env.BUILDKITE) === true ||
    parseEnvBoolean(env.TEAMCITY_VERSION) === true
  );
}

/**
 * Build the filter context object used for rule matching.
 * Assembles runtime information from various sources.
 */
export async function buildFilterContext(
  opts: BuildFilterContextOptions
): Promise<RuleFilterContext> {
  const {
    contextFilePaths,
    userPrompt,
    availableToolIDs,
    modelID,
    agentType,
    projectDirectory,
    debugLog,
  } = opts;

  const command = extractSlashCommand(userPrompt);

  let projectTags: string[] | undefined;
  try {
    projectTags = await detectProjectTags(projectDirectory);
    if (projectTags.length === 0) {
      projectTags = undefined;
    }
  } catch (error) {
    debugLog(`Failed to detect project tags: ${error}`);
    projectTags = undefined;
  }

  let gitBranch: string | null = null;
  try {
    gitBranch = await getGitBranch(projectDirectory);
  } catch (error) {
    debugLog(`Failed to get git branch: ${error}`);
    gitBranch = null;
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
  if (gitBranch !== null) {
    context.gitBranch = gitBranch;
  }

  debugLog(
    `Filter context: model=${modelID ?? 'none'}, agent=${agentType ?? 'none'}, ` +
      `command=${command ?? 'none'}, branch=${gitBranch ?? 'none'}, ` +
      `os=${os}, ci=${ci}, projectTags=${projectTags?.join(',') ?? 'none'}`
  );

  return context;
}
