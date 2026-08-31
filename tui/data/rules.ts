import {
  discoverRuleFiles,
  getCachedRule,
} from '../../src/rules/rule-discovery.js';
import { readMatchedRulesState } from '../../src/session/matched-rules-state.js';
import {
  hasConditions,
  type RuleMetadata,
} from '../../src/rules/rule-metadata.js';
export { hasConditions };
import path from 'node:path';

export interface SidebarRuleEntry {
  name: string;
  path: string;
  source: 'global' | 'project';
  isConditional: boolean;
  conditionSummary: string;
  metadata: RuleMetadata;
  // null means "not yet determined": a conditional rule with no state file.
  isActive: boolean | null;
}

export interface LoadSidebarRulesResult {
  rules: SidebarRuleEntry[];
  skippedCount: number;
  hasEvaluationState: boolean;
}

export async function loadSidebarRules(
  projectDir: string | null,
  sessionId?: string,
  options: { stateDir?: string } = {}
): Promise<LoadSidebarRulesResult> {
  // discoverRuleFiles accepts string | undefined, not null
  const discovered = await discoverRuleFiles(projectDir ?? undefined);

  const matchedState = sessionId
    ? await readMatchedRulesState(sessionId, options)
    : null;
  const hasEvaluationState = matchedState !== null;
  const matchedPathsSet = hasEvaluationState
    ? new Set(matchedState.matchedRulePaths)
    : null;

  const entries: SidebarRuleEntry[] = [];
  let skippedCount = 0;

  for (const rule of discovered) {
    const cached = await getCachedRule(rule.filePath);
    if (!cached) {
      skippedCount++;
      continue;
    }

    const meta = cached.metadata;
    const source = classifyRuleScope(rule.filePath, projectDir);
    const isConditional = hasConditions(meta);
    const conditionSummary = isConditional
      ? formatConditionSummary(meta!)
      : 'always active';

    let isActive: boolean | null;
    if (matchedPathsSet !== null) {
      isActive = matchedPathsSet.has(rule.filePath);
    } else {
      isActive = isConditional ? null : true;
    }

    entries.push({
      name: '',
      path: rule.relativePath,
      source,
      isConditional,
      conditionSummary,
      metadata: meta ?? {},
      isActive,
    });
  }

  disambiguateNames(entries);

  const sortPriority = (v: boolean | null): number =>
    v === true ? 0 : v === null ? 1 : 2;
  entries.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'project' ? -1 : 1;
    const activeCmp = sortPriority(a.isActive) - sortPriority(b.isActive);
    if (activeCmp !== 0) return activeCmp;
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) return nameCompare;
    return a.path.localeCompare(b.path);
  });

  return { rules: entries, skippedCount, hasEvaluationState };
}

// Prefix boundary matters: /project/.opencode/rules-extra/ must not match.
export function classifyRuleScope(
  filePath: string,
  projectDir: string | null
): 'global' | 'project' {
  if (!projectDir) return 'global';
  const projectRulesPrefix =
    path.join(projectDir, '.opencode', 'rules') + path.sep;
  return filePath.startsWith(projectRulesPrefix) ? 'project' : 'global';
}

export function formatConditionSummary(meta: RuleMetadata): string {
  const parts: string[] = [];

  const arrayFields: Array<[keyof RuleMetadata, string]> = [
    ['globs', 'globs'],
    ['fileContains', 'fileContains'],
    ['keywords', 'keywords'],
    ['tools', 'tools'],
    ['model', 'model'],
    ['agent', 'agent'],
    ['command', 'command'],
    ['project', 'project'],
    ['branch', 'branch'],
    ['os', 'os'],
  ];

  for (const [field, label] of arrayFields) {
    const value = meta[field];
    if (Array.isArray(value) && value.length > 0) {
      parts.push(`${label}: ${(value as string[]).join(', ')}`);
    }
  }

  if (meta.ci !== undefined) {
    parts.push(`ci: ${String(meta.ci)}`);
  }

  if (meta.match) {
    parts.push(`match: ${meta.match}`);
  }

  return parts.join(', ');
}

// Three-pass disambiguation: filename stem, then parent-dir prefix for
// duplicates, then full relative path if still ambiguous. Mutates
// entries[].name in place.
export function disambiguateNames(entries: SidebarRuleEntry[]): void {
  for (const entry of entries) {
    const basename = path.basename(entry.path);
    const dotIndex = basename.lastIndexOf('.');
    entry.name = dotIndex > 0 ? basename.substring(0, dotIndex) : basename;
  }

  const stemCounts = new Map<string, number>();
  for (const entry of entries) {
    stemCounts.set(entry.name, (stemCounts.get(entry.name) ?? 0) + 1);
  }

  for (const entry of entries) {
    if ((stemCounts.get(entry.name) ?? 0) <= 1) continue;

    const dir = path.dirname(entry.path);
    if (dir && dir !== '.') {
      const parent = path.basename(dir);
      entry.name = `${parent}/${entry.name}`;
    }
  }

  // Pass 3: still-ambiguous names fall back to the full path with extension.
  const nameCounts = new Map<string, number>();
  for (const entry of entries) {
    nameCounts.set(entry.name, (nameCounts.get(entry.name) ?? 0) + 1);
  }

  for (const entry of entries) {
    if ((nameCounts.get(entry.name) ?? 0) > 1) {
      entry.name = entry.path;
    }
  }
}
