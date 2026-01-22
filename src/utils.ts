/**
 * Utility functions for OpenCode Rules Plugin
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { minimatch } from 'minimatch';

/**
 * Check if a file path matches any of the given glob patterns
 */
export function fileMatchesGlobs(filePath: string, globs: string[]): boolean {
  return globs.some(glob => minimatch(filePath, glob, { matchBase: true }));
}

/**
 * Metadata extracted from .mdc file frontmatter
 */
export interface RuleMetadata {
  globs?: string[];
}

/**
 * Parse YAML metadata from rule file content
 * Extracts frontmatter (---) and returns metadata object
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

  // Parse globs from YAML
  const metadata: RuleMetadata = {};
  const globsMatch = frontmatter.match(/globs:\s*\n([\s\S]*?)(?=\n[a-z]|\n*$)/);

  if (globsMatch) {
    // Extract array items (lines starting with "- ")
    const globs: string[] = [];
    const globLines = globsMatch[1].split('\n');
    for (const line of globLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ')) {
        const glob = trimmed
          .substring(2)
          .replace(/^["']|["']$/g, '')
          .trim();
        if (glob) {
          globs.push(glob);
        }
      }
    }
    if (globs.length > 0) {
      metadata.globs = globs;
    }
  }

  // Return metadata only if it has content
  return Object.keys(metadata).length > 0 ? metadata : undefined;
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
function scanDirectoryRecursively(
  dir: string,
  baseDir: string
): Array<{ filePath: string; relativePath: string }> {
  const results: Array<{ filePath: string; relativePath: string }> = [];

  if (!existsSync(dir)) {
    return results;
  }

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden files and directories
      if (entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recurse into subdirectory
        results.push(...scanDirectoryRecursively(fullPath, baseDir));
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdc')) {
        // Add markdown file
        const relativePath = path.relative(baseDir, fullPath);
        results.push({ filePath: fullPath, relativePath });
      }
    }
  } catch {
    // Silently ignore directory read errors
  }

  return results;
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
): Promise<string[]> {
  const files: string[] = [];

  // Discover global rules (recursively)
  const globalRulesDir = getGlobalRulesDir();
  if (globalRulesDir) {
    const globalRules = scanDirectoryRecursively(
      globalRulesDir,
      globalRulesDir
    );
    for (const { filePath, relativePath } of globalRules) {
      console.debug(
        `[opencode-rules] Discovered global rule: ${relativePath} (${filePath})`
      );
      files.push(filePath);
    }
  }

  // Discover project-local rules (recursively) if project directory is provided
  if (projectDir) {
    const projectRulesDir = path.join(projectDir, '.opencode', 'rules');
    const projectRules = scanDirectoryRecursively(
      projectRulesDir,
      projectRulesDir
    );
    for (const { filePath, relativePath } of projectRules) {
      console.debug(
        `[opencode-rules] Discovered project rule: ${relativePath} (${filePath})`
      );
      files.push(filePath);
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
 * @param files - Array of rule file paths
 * @param contextFilePaths - Optional array of file paths from conversation context (used to filter conditional rules)
 */
export async function readAndFormatRules(
  files: string[],
  contextFilePaths?: string[]
): Promise<string> {
  if (files.length === 0) {
    return '';
  }

  const ruleContents: string[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const filename = path.basename(file);

      // Parse metadata to check if rule should apply
      const metadata = parseRuleMetadata(content);

      // If metadata exists with globs, check if any context path matches
      if (metadata?.globs) {
        // If we have context paths, filter by them
        if (contextFilePaths && contextFilePaths.length > 0) {
          const anyMatch = contextFilePaths.some(contextPath =>
            fileMatchesGlobs(contextPath, metadata.globs!)
          );
          if (!anyMatch) {
            // Rule does not apply to any file in context, skip it
            console.debug(
              `[opencode-rules] Skipping conditional rule: ${filename} (no matching paths)`
            );
            continue;
          }
          console.debug(
            `[opencode-rules] Including conditional rule: ${filename}`
          );
        }
        // If no context paths provided, include the rule (backward compatibility)
      }

      // Strip frontmatter before adding to output
      const cleanContent = stripFrontmatter(content);
      ruleContents.push(`## ${filename}\n\n${cleanContent}`);
    } catch (error) {
      // Log warning but continue with other files
      console.warn(`Warning: Failed to read rule file: ${file}`);
    }
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

type MessagePart = ToolInvocationPart | TextPart | { type: string };

interface Message {
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
