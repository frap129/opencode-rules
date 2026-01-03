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
 * Discover markdown rule files from standard directories
 * Searches in:
 * - $XDG_CONFIG_HOME/opencode/rules/*.{md,mdc} (or ~/.config/opencode/rules as fallback)
 * - .opencode/rules/*.{md,mdc} (in project directory if provided)
 */
export async function discoverRuleFiles(
  projectDir?: string
): Promise<string[]> {
  const files: string[] = [];

  // Discover global rules
  const globalRulesDir = getGlobalRulesDir();
  if (globalRulesDir && existsSync(globalRulesDir)) {
    try {
      const entries = readdirSync(globalRulesDir);
      for (const entry of entries) {
        // Skip hidden files and non-markdown files
        if (
          entry.startsWith('.') ||
          (!entry.endsWith('.md') && !entry.endsWith('.mdc'))
        ) {
          continue;
        }
        const filePath = path.join(globalRulesDir, entry);
        console.debug(
          `[opencode-rules] Discovered global rule: ${entry} (${filePath})`
        );
        files.push(filePath);
      }
    } catch (error) {
      // Silently ignore directory read errors
    }
  }

  // Discover project-local rules if project directory is provided
  if (projectDir) {
    const projectRulesDir = path.join(projectDir, '.opencode', 'rules');
    if (existsSync(projectRulesDir)) {
      try {
        const entries = readdirSync(projectRulesDir);
        for (const entry of entries) {
          // Skip hidden files and non-markdown files
          if (
            entry.startsWith('.') ||
            (!entry.endsWith('.md') && !entry.endsWith('.mdc'))
          ) {
            continue;
          }
          const filePath = path.join(projectRulesDir, entry);
          console.debug(
            `[opencode-rules] Discovered project rule: ${entry} (${filePath})`
          );
          files.push(filePath);
        }
      } catch (error) {
        // Silently ignore directory read errors
      }
    }
  }

  return files;
}

/**
 * Read and format rule files for system prompt injection
 * @param files - Array of rule file paths
 * @param contextFilePath - Optional path of the file being processed (used to filter rules by metadata)
 */
export async function readAndFormatRules(
  files: string[],
  contextFilePath?: string
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

      // If metadata exists with globs and a context file path is provided,
      // check if the context file matches any of the glob patterns
      if (metadata && metadata.globs && contextFilePath) {
        if (!fileMatchesGlobs(contextFilePath, metadata.globs)) {
          // Rule does not apply to this file, skip it
          continue;
        }
      }

      ruleContents.push(`## ${filename}\n\n${content}`);
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
    grep: ['path', 'include'],
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

  if (lastSlash === -1) return beforeGlob;
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
    const potentialPath = match[1];

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
