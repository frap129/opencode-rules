/**
 * Rule file discovery utilities
 */

import { stat, readFile, readdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import { createDebugLog } from './debug';
import {
  parseRuleMetadata,
  stripFrontmatter,
  type RuleMetadata,
} from './rule-metadata';

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
export async function getCachedRule(
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
 * Get the global rules directory path
 */
function getGlobalRulesDir(): string | null {
  const opencodeConfigDir = process.env.OPENCODE_CONFIG_DIR;
  if (opencodeConfigDir) {
    return path.join(opencodeConfigDir, 'rules');
  }

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
    // Treat ENOENT as benign (directory doesn't exist or was deleted)
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return results;
    }
    // Log non-ENOENT directory read errors
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
 * - $OPENCODE_CONFIG_DIR/rules/ (highest priority)
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
