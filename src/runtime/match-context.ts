import { extractSlashCommand } from '../session/message-extraction.js';
import { detectProjectTags } from '../detection/project-fingerprint.js';
import { getGitBranch } from '../detection/git-branch.js';
import type { RuleMatchContext } from '../rules/rule-filter.js';
import type { FileObservation } from '../session/file-observation.js';
import type { DebugLog } from '../shared/debug.js';

export interface BuildRuleMatchContextOptions {
  fileObservations: FileObservation[];
  userPrompt: string | undefined;
  availableToolIDs: string[];
  modelID: string | undefined;
  agentType: string | undefined;
  projectDirectory: string;
  debugLog: DebugLog;
}

// 'false', '0', and '' count as false; any other non-empty value is true.
function parseEnvBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === '') return false;
  const lower = value.toLowerCase();
  if (lower === 'false' || lower === '0') return false;
  return true;
}

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

export async function buildRuleMatchContext(
  opts: BuildRuleMatchContextOptions
): Promise<RuleMatchContext> {
  const {
    fileObservations,
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

  const context: RuleMatchContext = {
    os,
    ci,
  };

  if (fileObservations.length > 0) {
    context.fileObservations = fileObservations;
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
    `Match context: model=${modelID ?? 'none'}, agent=${agentType ?? 'none'}, ` +
      `command=${command ?? 'none'}, branch=${gitBranch ?? 'none'}, ` +
      `os=${os}, ci=${ci}, projectTags=${projectTags?.join(',') ?? 'none'}`
  );

  return context;
}
