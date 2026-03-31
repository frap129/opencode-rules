// tui/data/rules.ts
import { discoverRuleFiles, getCachedRule } from '../../src/rule-discovery.js';
import type { RuleMetadata } from '../../src/rule-metadata.js';
import path from 'path';

/** Represents a rule as displayed in the sidebar */
export interface SidebarRuleEntry {
  /** Display name (filename stem, disambiguated if needed) */
  name: string;
  /** Relative file path from the rules directory root */
  path: string;
  /** Whether this rule came from global or project-local rules dir */
  source: 'global' | 'project';
  /** Whether the rule has any conditional metadata */
  isConditional: boolean;
  /** Human-readable condition summary */
  conditionSummary: string;
  /** Full metadata for expanded view */
  metadata: RuleMetadata;
}

export interface LoadSidebarRulesResult {
  rules: SidebarRuleEntry[];
  skippedCount: number;
}

/**
 * Load all discovered rules formatted for sidebar display.
 * Reuses discoverRuleFiles/getCachedRule from the server plugin.
 *
 * @param projectDir - Project directory or null (global rules only)
 */
export async function loadSidebarRules(
  projectDir: string | null
): Promise<LoadSidebarRulesResult> {
  // discoverRuleFiles accepts string | undefined, not null
  const discovered = await discoverRuleFiles(projectDir ?? undefined);
  const entries: SidebarRuleEntry[] = [];
  let skippedCount = 0;

  for (const rule of discovered) {
    const cached = await getCachedRule(rule.filePath);
    if (!cached) {
      // getCachedRule() already logs a warning for read failures,
      // so we only increment the counter here — no duplicate log.
      skippedCount++;
      continue;
    }

    const meta = cached.metadata;
    const source = ruleSource(rule.filePath, projectDir);
    const isConditional = hasConditions(meta);
    const conditionSummary = isConditional
      ? formatConditionSummary(meta!)
      : 'always active';

    entries.push({
      name: '', // placeholder — set in disambiguation pass
      path: rule.relativePath,
      source,
      isConditional,
      conditionSummary,
      metadata: meta ?? {},
    });
  }

  disambiguateNames(entries);

  // Sort: project first, then global. Alpha by name, path as tiebreaker.
  entries.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'project' ? -1 : 1;
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) return nameCompare;
    return a.path.localeCompare(b.path);
  });

  return { rules: entries, skippedCount };
}

/**
 * Determine if a rule file is project-local or global.
 * Uses path.sep boundary check to avoid matching partial prefixes
 * (e.g., /project/.opencode/rules-extra/ should not match).
 */
export function ruleSource(
  filePath: string,
  projectDir: string | null
): 'global' | 'project' {
  if (!projectDir) return 'global';
  const projectRulesPrefix =
    path.join(projectDir, '.opencode', 'rules') + path.sep;
  return filePath.startsWith(projectRulesPrefix) ? 'project' : 'global';
}

/**
 * Check if metadata has any conditional fields set.
 */
export function hasConditions(meta: RuleMetadata | undefined): boolean {
  if (!meta) return false;
  return !!(
    meta.globs ||
    meta.keywords ||
    meta.tools ||
    meta.model ||
    meta.agent ||
    meta.command ||
    meta.project ||
    meta.branch ||
    meta.os ||
    meta.ci !== undefined
  );
}

/**
 * Build a human-readable, comma-separated summary of active conditions.
 * E.g., "globs: src/*.ts, keywords: auth, security"
 */
export function formatConditionSummary(meta: RuleMetadata): string {
  const parts: string[] = [];

  const arrayFields: Array<[keyof RuleMetadata, string]> = [
    ['globs', 'globs'],
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

/**
 * Three-pass name disambiguation.
 * Pass 1: Extract filename stem from each entry's path.
 * Pass 2: For duplicate stems, prefix with parent directory.
 * Pass 3: If still ambiguous (same parent or root-level), use full relative
 *         path (including extension) as the display name.
 *
 * Mutates entries[].name in place.
 */
export function disambiguateNames(entries: SidebarRuleEntry[]): void {
  // Pass 1: assign stem names (filename without extension, using last dot)
  for (const entry of entries) {
    const basename = path.basename(entry.path);
    const dotIndex = basename.lastIndexOf('.');
    entry.name = dotIndex > 0 ? basename.substring(0, dotIndex) : basename;
  }

  // Pass 2: detect and resolve collisions with parent directory prefix
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

  // Pass 3: if still ambiguous, use full relative path WITH extension
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
