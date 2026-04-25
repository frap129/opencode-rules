/**
 * Rule metadata parsing and frontmatter extraction
 */

const { parse: parseYaml } = await import('yaml');
import { logWarning } from './debug.js';

/**
 * Metadata extracted from .mdc file frontmatter
 */
export interface RuleMetadata {
  globs?: string[];
  keywords?: string[];
  tools?: string[];
  model?: string[];
  agent?: string[];
  command?: string[];
  project?: string[];
  branch?: string[];
  os?: string[];
  ci?: boolean;
  match?: 'any' | 'all';
  hooks?: RuleHook[];
}

export interface RuleHook {
  type: 'PreToolUse' | 'PostToolUse';
  tool: string;
  match: string;
  block?: boolean;
  run?: string;
}

/**
 * Raw parsed YAML frontmatter structure
 */
interface ParsedFrontmatter {
  globs?: unknown;
  keywords?: unknown;
  tools?: unknown;
  model?: unknown;
  agent?: unknown;
  command?: unknown;
  project?: unknown;
  branch?: unknown;
  os?: unknown;
  ci?: unknown;
  match?: unknown;
  hooks?: unknown;
}

/** Field names in ParsedFrontmatter that are string arrays */
type StringArrayField =
  | 'globs'
  | 'keywords'
  | 'tools'
  | 'model'
  | 'agent'
  | 'command'
  | 'project'
  | 'branch'
  | 'os';

/**
 * Extract and normalize a string array from parsed frontmatter.
 * Filters non-strings, trims whitespace, and removes empty values.
 *
 * @param value - Raw value from parsed YAML (may be array or undefined)
 * @returns Normalized string array, or undefined if empty after filtering
 */
function extractStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result = value
    .filter((v): v is string => typeof v === 'string')
    .map(v => v.trim())
    .filter(v => v.length > 0);
  return result.length > 0 ? result : undefined;
}

/**
 * Parse YAML metadata from rule file content using the yaml package.
 * Extracts frontmatter (---) and returns metadata object.
 */
export function parseRuleMetadata(content: string): RuleMetadata | null {
  if (!content.startsWith('---')) {
    return null;
  }

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return null;
  }

  const frontmatter = content.substring(3, endIndex).trim();
  if (!frontmatter) {
    return null;
  }

  try {
    const parsed = parseYaml(frontmatter) as ParsedFrontmatter | null;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const metadata: RuleMetadata = {};

    const arrayFields: StringArrayField[] = [
      'globs',
      'keywords',
      'tools',
      'model',
      'agent',
      'command',
      'project',
      'branch',
      'os',
    ];

    for (const field of arrayFields) {
      const extracted = extractStringArray(parsed[field]);
      if (extracted) {
        metadata[field] = extracted;
      }
    }

    if (typeof parsed.ci === 'boolean') {
      metadata.ci = parsed.ci;
    }

    if (parsed.match === 'any' || parsed.match === 'all') {
      metadata.match = parsed.match;
    }

    // Extract hooks
    if (Array.isArray(parsed.hooks)) {
      const hooks: RuleHook[] = [];
      for (const h of parsed.hooks) {
        if (typeof h !== 'object' || h === null) continue;
        const hook = h as Record<string, unknown>;
        if (
          (hook.type === 'PreToolUse' || hook.type === 'PostToolUse') &&
          typeof hook.tool === 'string' &&
          hook.tool.length > 0 &&
          typeof hook.match === 'string' &&
          hook.match.length > 0
        ) {
          hooks.push({
            type: hook.type,
            tool: hook.tool,
            match: hook.match,
            ...(typeof hook.block === 'boolean' && { block: hook.block }),
            ...(typeof hook.run === 'string' &&
              hook.run.length > 0 && { run: hook.run }),
          });
        }
      }
      if (hooks.length > 0) {
        metadata.hooks = hooks;
      }
    }

    return Object.keys(metadata).length > 0 ? metadata : null;
  } catch (error) {
    logWarning('Failed to parse YAML frontmatter', error);
    return null;
  }
}

/**
 * Strip YAML frontmatter from rule content
 */
export function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) {
    return content;
  }

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return content;
  }

  return content.substring(endIndex + 3).trimStart();
}

/**
 * Check if metadata has any conditional fields set.
 */
export function hasConditions(meta: RuleMetadata | null | undefined): boolean {
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
