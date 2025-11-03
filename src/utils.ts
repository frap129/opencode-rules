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
