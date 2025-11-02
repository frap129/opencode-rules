/**
 * OpenCode Rules Plugin
 *
 * This plugin discovers markdown rule files from standard directories
 * and injects them into the OpenCode agent system prompt.
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import type { Plugin, PluginInput } from '@opencode-ai/plugin';

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
        files.push(path.join(globalRulesDir, entry));
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
          files.push(path.join(projectRulesDir, entry));
        }
      } catch (error) {
        // Silently ignore directory read errors
      }
    }
  }

  return files;
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
 * Read and format rule files for system prompt injection
 */
export async function readAndFormatRules(files: string[]): Promise<string> {
  if (files.length === 0) {
    return '';
  }

  const ruleContents: string[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const filename = path.basename(file);
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
 * OpenCode Rules Plugin
 * Discovers markdown rule files and injects them into system prompts
 */
const openCodeRulesPlugin: Plugin = async (input: PluginInput) => {
  // Discover rule files from global and project directories
  const ruleFiles = await discoverRuleFiles(input.directory);
  const formattedRules = await readAndFormatRules(ruleFiles);

  return {
    'chat.params': async (_input: any, output: any) => {
      if (formattedRules) {
        output.options.systemPromptSuffix = formattedRules;
      }
    },
  };
};

export default openCodeRulesPlugin;
