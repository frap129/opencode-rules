/**
 * Utility functions for OpenCode Rules Plugin
 */

import { stat, readFile, readdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import { minimatch } from 'minimatch';
import { parse as parseYaml } from 'yaml';
import { createDebugLog } from './debug.js';

const debugLog = createDebugLog();

/**
 * Cached rule data for performance optimization
 */
interface CachedRule {
  /** Raw file content */
  content: string;
  /** Parsed metadata from frontmatter */
  metadata: RuleMetadata | undefined;
  /** Content with frontmatter stripped */
  strippedContent: string;
  /** File modification time for cache invalidation */
  mtime: number;
}

/**
 * Rule cache keyed by absolute file path
 */
const ruleCache = new Map<string, CachedRule>();

/**
 * Clear the rule cache (useful for testing or manual invalidation)
 */
export function clearRuleCache(): void {
  ruleCache.clear();
}

/**
 * Get cached rule data, refreshing from disk if file has changed.
 * Uses mtime-based invalidation to detect file changes.
 *
 * @param filePath - Absolute path to the rule file
 * @returns Cached rule data or undefined if file cannot be read
 */
async function getCachedRule(
  filePath: string
): Promise<CachedRule | undefined> {
  try {
    const stats = await stat(filePath);
    const mtime = stats.mtimeMs;

    // Check if we have a valid cached entry
    const cached = ruleCache.get(filePath);
    if (cached && cached.mtime === mtime) {
      debugLog(`Cache hit: ${filePath}`);
      return cached;
    }

    // Read and cache the file
    debugLog(`Cache miss: ${filePath}`);
    const content = await readFile(filePath, 'utf-8');
    const metadata = parseRuleMetadata(content);
    const strippedContent = stripFrontmatter(content);

    const entry: CachedRule = {
      content,
      metadata,
      strippedContent,
      mtime,
    };

    ruleCache.set(filePath, entry);
    return entry;
  } catch (error) {
    // Remove stale cache entry if file no longer exists
    ruleCache.delete(filePath);
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[opencode-rules] Warning: Failed to read rule file ${filePath}: ${message}`
    );
    return undefined;
  }
}

/**
 * Check if a file path matches any of the given glob patterns
 */
export function fileMatchesGlobs(filePath: string, globs: string[]): boolean {
  return globs.some(glob => minimatch(filePath, glob, { matchBase: true }));
}

/**
 * Check if a user prompt matches any of the given keywords.
 * Uses case-insensitive word-boundary matching.
 *
 * @param prompt - The user's prompt text
 * @param keywords - Array of keywords to match
 * @returns true if any keyword matches the prompt
 */
export function promptMatchesKeywords(
  prompt: string,
  keywords: string[]
): boolean {
  const lowerPrompt = prompt.toLowerCase();

  return keywords.some(keyword => {
    const lowerKeyword = keyword.toLowerCase();
    // Escape special regex characters in the keyword
    const escaped = lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Word boundary at start, but allow continuation at end (e.g., "test" matches "testing")
    const regex = new RegExp(`\\b${escaped}`, 'i');
    return regex.test(lowerPrompt);
  });
}

/**
 * Check if any of the required tools are available.
 * Uses exact string matching (OR logic: any match returns true).
 *
 * @param availableToolIDs - Array of tool IDs currently available
 * @param requiredTools - Array of tool IDs from rule metadata
 * @returns true if any required tool is available
 */
export function toolsMatchAvailable(
  availableToolIDs: string[],
  requiredTools: string[]
): boolean {
  if (requiredTools.length === 0) {
    return false;
  }
  // Create a Set for O(1) lookups
  const availableSet = new Set(availableToolIDs);
  return requiredTools.some(tool => availableSet.has(tool));
}

/**
 * Metadata extracted from .mdc file frontmatter
 */
export interface RuleMetadata {
  globs?: string[];
  keywords?: string[];
  tools?: string[];
}

/**
 * Raw parsed YAML frontmatter structure
 */
interface ParsedFrontmatter {
  globs?: unknown;
  keywords?: unknown;
  tools?: unknown;
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

    // Extract globs array
    if (Array.isArray(parsed.globs)) {
      const globs = parsed.globs
        .filter((g): g is string => typeof g === 'string')
        .map(g => g.trim())
        .filter(g => g.length > 0);
      if (globs.length > 0) {
        metadata.globs = globs;
      }
    }

    // Extract keywords array
    if (Array.isArray(parsed.keywords)) {
      const keywords = parsed.keywords
        .filter((k): k is string => typeof k === 'string')
        .map(k => k.trim())
        .filter(k => k.length > 0);
      if (keywords.length > 0) {
        metadata.keywords = keywords;
      }
    }

    // Extract tools array
    if (Array.isArray(parsed.tools)) {
      const tools = parsed.tools
        .filter((t): t is string => typeof t === 'string')
        .map(t => t.trim())
        .filter(t => t.length > 0);
      if (tools.length > 0) {
        metadata.tools = tools;
      }
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
 * Get the global rules directory path
 */
function getGlobalRulesDir(): string | null {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, 'opencode', 'rules');
  }

  const homeDir = process.env.HOME || os.homedir();
  return path.join(homeDir, '.config', 'opencode', 'rules');
}

/**
 * Recursively scan a directory for markdown rule files
 * Skips hidden files and directories (starting with .)
 * @param dir - Directory to scan
 * @param baseDir - Base directory for relative path calculation
 * @returns Array of discovered file paths with their relative paths from baseDir
 */
async function scanDirectoryRecursively(
  dir: string,
  baseDir: string
): Promise<Array<{ filePath: string; relativePath: string }>> {
  const results: Array<{ filePath: string; relativePath: string }> = [];

  try {
    await stat(dir);
  } catch {
    return results;
  }

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden files and directories
      if (entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recurse into subdirectory
        results.push(...(await scanDirectoryRecursively(fullPath, baseDir)));
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdc')) {
        // Add markdown file
        const relativePath = path.relative(baseDir, fullPath);
        results.push({ filePath: fullPath, relativePath });
      }
    }
  } catch (error) {
    // Log directory read errors instead of silently ignoring
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[opencode-rules] Warning: Failed to read directory ${dir}: ${message}`
    );
  }

  return results;
}

/**
 * Discovered rule file with both absolute and relative paths
 */
export interface DiscoveredRule {
  /** Absolute path to the rule file */
  filePath: string;
  /** Relative path from the rules directory root (for unique headings) */
  relativePath: string;
}

/**
 * Discover markdown rule files from standard directories
 * Searches recursively in:
 * - $XDG_CONFIG_HOME/opencode/rules/ (or ~/.config/opencode/rules as fallback)
 * - .opencode/rules/ (in project directory if provided)
 * Finds all .md and .mdc files including nested subdirectories.
 */
export async function discoverRuleFiles(
  projectDir?: string
): Promise<DiscoveredRule[]> {
  const files: DiscoveredRule[] = [];

  // Discover global rules (recursively)
  const globalRulesDir = getGlobalRulesDir();
  if (globalRulesDir) {
    const globalRules = await scanDirectoryRecursively(
      globalRulesDir,
      globalRulesDir
    );
    for (const { filePath, relativePath } of globalRules) {
      debugLog(`Discovered global rule: ${relativePath} (${filePath})`);
      files.push({ filePath, relativePath });
    }
  }

  // Discover project-local rules (recursively) if project directory is provided
  if (projectDir) {
    const projectRulesDir = path.join(projectDir, '.opencode', 'rules');
    const projectRules = await scanDirectoryRecursively(
      projectRulesDir,
      projectRulesDir
    );
    for (const { filePath, relativePath } of projectRules) {
      debugLog(`Discovered project rule: ${relativePath} (${filePath})`);
      files.push({ filePath, relativePath });
    }
  }

  return files;
}

/**
 * Strip YAML frontmatter from rule content
 */
function stripFrontmatter(content: string): string {
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

/**
 * Read and format rule files for system prompt injection
 * @param files - Array of discovered rule files with paths
 * @param contextFilePaths - Optional array of file paths from conversation context (used to filter conditional rules)
 * @param userPrompt - Optional user prompt text (used for keyword matching)
 * @param availableToolIDs - Optional array of available tool IDs (used for tool-based filtering)
 */
export async function readAndFormatRules(
  files: DiscoveredRule[],
  contextFilePaths?: string[],
  userPrompt?: string,
  availableToolIDs?: string[]
): Promise<string> {
  if (files.length === 0) {
    return '';
  }

  const ruleContents: string[] = [];
  const availableToolSet =
    availableToolIDs && availableToolIDs.length > 0
      ? new Set(availableToolIDs)
      : undefined;

  for (const { filePath, relativePath } of files) {
    // Use cached rule data with mtime-based invalidation
    const cachedRule = await getCachedRule(filePath);
    if (!cachedRule) {
      continue; // Error already logged by getCachedRule
    }

    const { metadata, strippedContent } = cachedRule;

    // Rules with metadata (globs, keywords, or tools) require matching
    // OR logic: rule applies if keywords match OR globs match OR tools match
    if (metadata?.globs || metadata?.keywords || metadata?.tools) {
      let globsMatch = false;
      let keywordsMatch = false;
      let toolsMatch = false;

      // Check globs against context file paths
      if (metadata.globs && contextFilePaths && contextFilePaths.length > 0) {
        globsMatch = contextFilePaths.some(contextPath =>
          fileMatchesGlobs(contextPath, metadata.globs!)
        );
      }

      // Check keywords against user prompt
      if (metadata.keywords && userPrompt) {
        keywordsMatch = promptMatchesKeywords(userPrompt, metadata.keywords);
      }

      // Check tools against available tool IDs
      if (metadata.tools && availableToolSet) {
        toolsMatch = metadata.tools.some(tool => availableToolSet.has(tool));
      }

      // If rule has conditions but none match, skip it
      if (!globsMatch && !keywordsMatch && !toolsMatch) {
        debugLog(
          `Skipping conditional rule: ${relativePath} (no matching paths, keywords, or tools)`
        );
        continue;
      }

      debugLog(
        `Including conditional rule: ${relativePath} (globs: ${globsMatch}, keywords: ${keywordsMatch}, tools: ${toolsMatch})`
      );
    }

    // Use cached stripped content for output
    // Use relativePath for unique headings instead of just filename
    ruleContents.push(`## ${relativePath}\n\n${strippedContent}`);
  }

  if (ruleContents.length === 0) {
    return '';
  }

  return (
    `# OpenCode Rules\n\nPlease follow the following rules:\n\n` +
    ruleContents.join('\n\n---\n\n')
  );
}

/**
 * Message part types from OpenCode plugin API
 */
interface ToolInvocationPart {
  type: 'tool-invocation';
  toolInvocation: {
    toolName: string;
    args: Record<string, unknown>;
  };
}

interface TextPart {
  type: 'text';
  text: string;
}

export type MessagePart = ToolInvocationPart | TextPart | { type: string };

export interface Message {
  role: string;
  parts: MessagePart[];
}

/**
 * Extract file paths from conversation messages for conditional rule filtering.
 * Parses tool call arguments and scans message content for path-like strings.
 *
 * @param messages - Array of conversation messages
 * @returns Deduplicated array of file paths found in messages
 */
export function extractFilePathsFromMessages(messages: Message[]): string[] {
  const paths = new Set<string>();

  for (const message of messages) {
    for (const part of message.parts) {
      // Extract from tool invocations
      if (part.type === 'tool-invocation') {
        const toolPart = part as ToolInvocationPart;
        extractPathsFromToolCall(toolPart, paths);
      }

      // Extract from text content
      if (part.type === 'text') {
        const textPart = part as TextPart;
        extractPathsFromText(textPart.text, paths);
      }
    }
  }

  return Array.from(paths);
}

/**
 * Extract file paths from tool call arguments
 */
function extractPathsFromToolCall(
  part: ToolInvocationPart,
  paths: Set<string>
): void {
  const { toolName, args } = part.toolInvocation;

  // Tools that have a direct file path argument
  const pathArgTools: Record<string, string[]> = {
    read: ['filePath'],
    edit: ['filePath'],
    write: ['filePath'],
    glob: ['pattern', 'path'],
    grep: ['path'],
  };

  const argNames = pathArgTools[toolName];
  if (argNames) {
    for (const argName of argNames) {
      const value = args[argName];
      if (typeof value === 'string' && value.length > 0) {
        // For glob patterns, extract the directory part
        if (argName === 'pattern') {
          const dirPart = extractDirFromGlob(value);
          if (dirPart) paths.add(dirPart);
        } else {
          paths.add(value);
        }
      }
    }
  }
}

/**
 * Extract directory path from a glob pattern
 */
function extractDirFromGlob(pattern: string): string | null {
  // Find the first glob character
  const globChars = ['*', '?', '[', '{'];
  let firstGlobIndex = pattern.length;

  for (const char of globChars) {
    const idx = pattern.indexOf(char);
    if (idx !== -1 && idx < firstGlobIndex) {
      firstGlobIndex = idx;
    }
  }

  if (firstGlobIndex === 0) return null;

  // Get the directory part before the glob
  const beforeGlob = pattern.substring(0, firstGlobIndex);
  const lastSlash = beforeGlob.lastIndexOf('/');

  if (lastSlash === -1) {
    // If no slash and pattern has glob characters, it's just a file prefix, not a directory
    if (firstGlobIndex < pattern.length) return null;
    return beforeGlob;
  }
  return beforeGlob.substring(0, lastSlash);
}

/**
 * Extract file paths from text content using regex
 */
function extractPathsFromText(text: string, paths: Set<string>): void {
  // Match paths that look like file paths:
  // - Start with ./, ../, /, or a word character
  // - Contain at least one /
  // - End with a file extension or directory
  const pathRegex =
    /(?:^|[\s"'`(])((\.{0,2}\/)?[\w./-]+\/[\w./-]+(?:\.\w+)?)/gm;

  let match;
  while ((match = pathRegex.exec(text)) !== null) {
    let potentialPath = match[1];

    // Trim trailing punctuation that likely belongs to prose, not the path
    potentialPath = potentialPath.replace(/[.,!?:;]+$/, '');

    // Filter out URLs and other non-paths
    if (
      potentialPath.includes('://') ||
      potentialPath.startsWith('http') ||
      potentialPath.includes('@')
    ) {
      continue;
    }

    // Must have a reasonable structure (not just slashes)
    if (potentialPath.replace(/[/.]/g, '').length > 0) {
      paths.add(potentialPath);
    }
  }
}
