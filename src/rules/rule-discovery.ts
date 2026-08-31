import { stat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createDebugLog, logWarning } from '../shared/debug.js';
import {
  parseRuleMetadata,
  stripFrontmatter,
  type RuleMetadata,
} from './rule-metadata.js';

const debugLog = createDebugLog();

interface CachedRule {
  content: string;
  metadata: RuleMetadata | null;
  strippedContent: string;
  mtime: number;
}

const ruleCache = new Map<string, CachedRule>();

export function clearRuleCache(): void {
  ruleCache.clear();
}

export async function getCachedRule(
  filePath: string
): Promise<CachedRule | null> {
  try {
    const stats = await stat(filePath);
    const mtime = stats.mtimeMs;

    const cached = ruleCache.get(filePath);
    if (cached && cached.mtime === mtime) {
      debugLog(`Cache hit: ${filePath}`);
      return cached;
    }

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
    ruleCache.delete(filePath);
    logWarning(`Failed to read rule file ${filePath}`, error);
    return null;
  }
}

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

async function scanDirectoryRecursively(
  dir: string,
  baseDir: string
): Promise<Array<{ filePath: string; relativePath: string }>> {
  const results: Array<{ filePath: string; relativePath: string }> = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        results.push(...(await scanDirectoryRecursively(fullPath, baseDir)));
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdc')) {
        const relativePath = path.relative(baseDir, fullPath);
        results.push({ filePath: fullPath, relativePath });
      }
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return results;
    }
    logWarning(`Failed to read directory ${dir}`, error);
  }

  return results;
}

export interface DiscoveredRule {
  filePath: string;
  relativePath: string;
}

// One snapshot per process/session; file edits never affect an existing
// session's snapshot.
export interface RuleSnapshot extends DiscoveredRule {
  name: string;
  metadata: RuleMetadata | null;
  strippedContent: string;
}

export async function loadRuleSnapshots(
  files: readonly DiscoveredRule[]
): Promise<RuleSnapshot[]> {
  const snapshots: RuleSnapshot[] = [];
  for (const file of files) {
    const cachedRule = await getCachedRule(file.filePath);
    if (!cachedRule) continue;
    snapshots.push({
      ...file,
      name:
        cachedRule.metadata?.name ??
        file.relativePath
          .split(/[\\/]/)
          .at(-1)
          ?.replace(/\.(?:md|mdc)$/i, '') ??
        file.relativePath,
      metadata: cachedRule.metadata,
      strippedContent: cachedRule.strippedContent,
    });
  }
  return snapshots;
}

// Priority: OPENCODE_CONFIG_DIR > XDG_CONFIG_HOME/opencode > ~/.config/opencode
export async function discoverRuleFiles(
  projectDir?: string
): Promise<DiscoveredRule[]> {
  const files: DiscoveredRule[] = [];

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
