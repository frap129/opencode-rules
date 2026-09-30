import path from 'node:path';
import os from 'node:os';
import { createDebugLog, formatError, logWarning } from '../shared/debug.js';

const debugLog = createDebugLog();

// The single place a plugin entry's `options` block is interpreted, so the
// server and TUI config surfaces share one contract.
export interface PluginOptions {
  readonly additionalRuleDirectories: string[];
}

export function parsePluginOptions(
  raw: Readonly<Record<string, unknown>> | undefined
): PluginOptions {
  try {
    return {
      additionalRuleDirectories: parseDirectoryEntries(
        readAdditionalRuleDirectories(raw)
      ),
    };
  } catch (error) {
    // A hand-written config can supply anything, and a throwing getter on the
    // options object or on one of its entries would break plugin load.
    logWarning('Failed to parse plugin options', error);
    return { additionalRuleDirectories: [] };
  }
}

export function resolveAdditionalRuleDirectories(
  entries: readonly string[],
  projectDir: string | null
): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const expanded = expandHome(entry);
    // Falsy rather than `=== null`: the sidebar side has no project root and
    // reports it as an empty string, and resolving against '' would silently
    // use process.cwd().
    if (!path.isAbsolute(expanded) && !projectDir) {
      debugLog(
        `Skipping relative additional rule directory "${entry}" (no project directory)`
      );
      continue;
    }
    // The base only applies to relative entries, so an absolute entry resolves
    // to its own normalized form whatever the project directory is.
    const absolute = path.resolve(projectDir ?? '', expanded);
    if (seen.has(absolute)) {
      debugLog(`Duplicate additional rule directory: ${absolute}`);
      continue;
    }
    seen.add(absolute);
    resolved.push(absolute);
  }
  return resolved;
}

function readAdditionalRuleDirectories(
  raw: Readonly<Record<string, unknown>> | undefined
): unknown {
  if (raw === null || typeof raw !== 'object') return undefined;
  return raw.additionalRuleDirectories;
}

function parseDirectoryEntries(value: unknown): string[] {
  if (typeof value !== 'string' && !Array.isArray(value)) {
    if (value !== undefined) {
      debugLog(
        `Ignoring additionalRuleDirectories of unsupported type: ${formatError(value)}`
      );
    }
    return [];
  }
  // A bare string is shorthand for a one-entry list.
  const candidates = typeof value === 'string' ? [value] : value;
  return candidates.flatMap(entry => {
    if (typeof entry !== 'string') {
      debugLog(
        `Ignoring non-string additionalRuleDirectories entry: ${formatError(entry)}`
      );
      return [];
    }
    const trimmed = entry.trim();
    if (trimmed === '') {
      debugLog('Ignoring empty additionalRuleDirectories entry');
      return [];
    }
    return [trimmed];
  });
}

function expandHome(entry: string): string {
  if (!entry.startsWith('~')) return entry;
  if (entry !== '~' && !entry.startsWith('~/') && !entry.startsWith('~\\')) {
    debugLog(
      `Not expanding "${entry}": only "~/" and "~" refer to the home directory`
    );
    return entry;
  }
  return path.join(process.env.HOME || os.homedir(), entry.slice(1));
}
