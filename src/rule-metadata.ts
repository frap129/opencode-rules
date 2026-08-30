const { parse: parseYaml } = await import('yaml');
import { logWarning } from './debug.js';

export interface RuleMetadata {
  name?: string;
  globs?: string[];
  /** Case-sensitive literal substrings; empty array means declared but invalid (fail-closed). */
  fileContains?: string[];
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

interface ParsedFrontmatter {
  name?: unknown;
  globs?: unknown;
  fileContains?: unknown;
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

// Unlike the other condition fields, a declared fileContains that yields no
// valid literal resolves to [] (not undefined) so the rule fails closed
// instead of degrading to unconditional.
function extractFileContains(value: unknown): string[] {
  const entries =
    typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  const result: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'string') continue;
    const literal = entry.trim();
    if (literal.length === 0 || result.includes(literal)) continue;
    result.push(literal);
  }
  return result;
}

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

    if (typeof parsed.name === 'string' && parsed.name.trim().length > 0) {
      metadata.name = parsed.name.trim();
    }

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

    if (parsed.fileContains !== undefined) {
      const literals = extractFileContains(parsed.fileContains);
      if (literals.length === 0) {
        logWarning(
          'fileContains declared with no valid literal; rule never matches',
          new Error('empty fileContains frontmatter')
        );
      }
      metadata.fileContains = literals;
    }

    if (typeof parsed.ci === 'boolean') {
      metadata.ci = parsed.ci;
    }

    if (parsed.match === 'any' || parsed.match === 'all') {
      metadata.match = parsed.match;
    }

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

export function hasConditions(meta: RuleMetadata | null | undefined): boolean {
  if (!meta) return false;
  return !!(
    meta.globs ||
    meta.fileContains !== undefined ||
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
