import { minimatch } from 'minimatch';
import { createDebugLog } from './debug.js';
import type { RuleSnapshot } from './rule-discovery.js';
import { hasConditions } from './rule-metadata.js';
import type { RuleMetadata } from './rule-metadata.js';
import type { FileObservation } from './file-observation.js';

const debugLog = createDebugLog();

// Durable rules persist as synthetic parts in session history; ephemeral
// rules ride only request-scoped transient messages.
export type RuleLifetime = 'durable' | 'ephemeral';

export type RuleConditionKind =
  | 'globs'
  | 'fileContains'
  | 'keywords'
  | 'tools'
  | 'model'
  | 'agent'
  | 'command'
  | 'project'
  | 'branch'
  | 'os'
  | 'ci';

export interface ConditionEvaluation {
  kind: RuleConditionKind;
  matched: boolean;
  lifetime: RuleLifetime;
}

const DURABLE_KINDS: ReadonlySet<RuleConditionKind> = new Set([
  'globs',
  'fileContains',
  'keywords',
  'command',
  'project',
  'os',
  'ci',
]);

function lifetimeForKind(kind: RuleConditionKind): RuleLifetime {
  return DURABLE_KINDS.has(kind) ? 'durable' : 'ephemeral';
}

// `match: all` is ephemeral when any required condition is ephemeral;
// `match: any` is durable when at least one satisfied condition is durable.
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

function fileMatchesGlobs(filePath: string, globs: string[]): boolean {
  return globs.some(glob => minimatch(filePath, glob, { matchBase: true }));
}

function contentMatchesLiterals(content: string, literals: string[]): boolean {
  return literals.some(literal => content.includes(literal));
}

export function promptMatchesKeywords(
  prompt: string,
  keywords: string[]
): boolean {
  const lowerPrompt = prompt.toLowerCase();

  return keywords.some(keyword => {
    const lowerKeyword = keyword.toLowerCase();
    const escaped = lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Leading word boundary only: "test" matches "testing".
    const regex = new RegExp(`\\b${escaped}`, 'i');
    return regex.test(lowerPrompt);
  });
}

export function toolsMatchAvailable(
  availableToolIDs: string[],
  requiredTools: string[]
): boolean {
  const availableSet = new Set(availableToolIDs);
  return requiredTools.some(tool => availableSet.has(tool));
}

export function hasFileObservationFamily(
  metadata: RuleMetadata | null | undefined
): boolean {
  return metadata?.globs !== undefined || metadata?.fileContains !== undefined;
}

// With both globs and fileContains declared, one observation must satisfy
// its path pattern AND contain a literal; globs alone keeps legacy
// behavior across the observation set.
function evaluateFileObservationFamily(
  metadata: RuleMetadata,
  context: RuleMatchContext
): ConditionEvaluation | undefined {
  if (!hasFileObservationFamily(metadata)) return undefined;
  const { globs, fileContains } = metadata;

  const failClosed = fileContains !== undefined && fileContains.length === 0;
  // The parse-time warning in rule-metadata covers the failure; here it
  // only fails closed, silently.

  const matchable = failClosed
    ? undefined
    : (context.fileObservations ?? []).find(
        observation =>
          (!globs || fileMatchesGlobs(observation.path, globs)) &&
          (fileContains === undefined ||
            contentMatchesLiterals(observation.content, fileContains))
      );

  if (fileContains !== undefined) {
    return {
      kind: 'fileContains',
      matched: Boolean(matchable),
      lifetime: lifetimeForKind('fileContains'),
    };
  }
  return {
    kind: 'globs',
    matched: Boolean(matchable),
    lifetime: lifetimeForKind('globs'),
  };
}

function evaluateConditionChecks(
  metadata: RuleMetadata,
  context: RuleMatchContext,
  availableToolSet?: Set<string>
): ConditionEvaluation[] {
  const checks: ConditionEvaluation[] = [];

  const familyCheck = evaluateFileObservationFamily(metadata, context);
  if (familyCheck) {
    checks.push(familyCheck);
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

export interface RuleMatchContext {
  fileObservations?: FileObservation[];
  userPrompt?: string;
  availableToolIDs?: string[];
  modelID?: string;
  agentType?: string;
  command?: string;
  projectTags?: string[];
  gitBranch?: string;
  os?: string;
  ci?: boolean;
}

export interface MatchedRuleEntry {
  filePath: string;
  relativePath: string;
  name: string;
  strippedContent: string;
  conditionResults: ConditionEvaluation[];
  lifetime: RuleLifetime;
}

export function matchRuleSnapshots(
  snapshots: readonly RuleSnapshot[],
  context: RuleMatchContext = {}
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
