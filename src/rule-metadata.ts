/**
 * Rule metadata parsing and frontmatter extraction
 */

import { parse as parseYaml } from 'yaml';

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
export function parseRuleMetadata(content: string): RuleMetadata | undefined {
  // Check if content starts with frontmatter
  if (!content.startsWith('---')) {
    return undefined;
  }

  // Find the closing --- marker
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return undefined;
  }

  // Extract the YAML frontmatter
  const frontmatter = content.substring(3, endIndex).trim();
  if (!frontmatter) {
    return undefined;
  }

  try {
    // Parse YAML using the yaml package
    const parsed = parseYaml(frontmatter) as ParsedFrontmatter | null;
    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }

    const metadata: RuleMetadata = {};

    // Array fields to extract using shared helper
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

    // Extract ci boolean (only if strictly boolean)
    if (typeof parsed.ci === 'boolean') {
      metadata.ci = parsed.ci;
    }

    // Extract match (normalize to 'any' | 'all' only)
    if (parsed.match === 'any' || parsed.match === 'all') {
      metadata.match = parsed.match;
    }

    // Return metadata only if it has content
    return Object.keys(metadata).length > 0 ? metadata : undefined;
  } catch (error) {
    // Log warning for YAML parsing errors
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[opencode-rules] Warning: Failed to parse YAML frontmatter: ${message}`
    );
    return undefined;
  }
}

/**
 * Strip YAML frontmatter from rule content
 */
export function stripFrontmatter(content: string): string {
  // Check if content starts with frontmatter
  if (!content.startsWith('---')) {
    return content;
  }

  // Find the closing --- marker
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return content;
  }

  // Return content after the closing marker, trimming leading newline
  return content.substring(endIndex + 3).trimStart();
}
