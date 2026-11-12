const { parse: parseYaml } = await import('yaml');
import { logWarning } from '../shared/debug.js';

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
  paths?: unknown;
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

function toEntries(value: unknown): unknown[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value : [];
}

// Unlike the other condition fields, a declared fileContains that yields no
// valid literal resolves to [] (not undefined) so the rule fails closed
// instead of degrading to unconditional.
function extractFileContains(value: unknown): string[] {
  const result: string[] = [];
  for (const entry of toEntries(value)) {
    if (typeof entry !== 'string') continue;
    const literal = entry.trim();
    if (literal.length === 0 || result.includes(literal)) continue;
    result.push(literal);
  }
  return result;
}

function extractStringArray(value: unknown): string[] | undefined {
  if (typeof value !== 'string' && !Array.isArray(value)) {
    return undefined;
  }
  return toEntries(value)
    .filter((v): v is string => typeof v === 'string')
    .map(v => v.trim())
    .filter(v => v.length > 0);
}

// `paths` accepts Claude Code's comma-separated string form in addition to
// the scalar/array forms. Split on top-level commas only so brace expansions
// and character classes keep their commas.
function splitPathPatterns(value: string): string[] {
  const patterns: string[] = [];
  let current = '';
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < value.length; index++) {
    const character = value[index];

    if (character === '\\') {
      current += character;
      const next = value[index + 1];
      if (next !== undefined) {
        current += next;
        index++;
      }
      continue;
    }

    if (character === '{') {
      braceDepth++;
    } else if (character === '}' && braceDepth > 0) {
      braceDepth--;
    } else if (character === '[') {
      bracketDepth++;
    } else if (character === ']' && bracketDepth > 0) {
      bracketDepth--;
    }

    if (character === ',' && braceDepth === 0 && bracketDepth === 0) {
      patterns.push(current);
      current = '';
      continue;
    }

    current += character;
  }

  patterns.push(current);
  return patterns;
}

function extractPaths(value: unknown): string[] | undefined {
  if (typeof value !== 'string' && !Array.isArray(value)) {
    return undefined;
  }
  return toEntries(value)
    .filter((entry): entry is string => typeof entry === 'string')
    .flatMap(entry => splitPathPatterns(entry))
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
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

    // Claude Code uses `paths` for the same condition; normalize it into
    // globs so the rest of the pipeline sees one field. Presence, not
    // truthiness, decides fail-closed handling for malformed declarations.
    if (parsed.paths !== undefined) {
      metadata.globs = [
        ...(metadata.globs ?? []),
        ...(extractPaths(parsed.paths) ?? []),
      ];
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
