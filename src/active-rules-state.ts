import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { createDebugLog } from './debug.js';

const debugLog = createDebugLog();

export interface ActiveRulesState {
  sessionId: string;
  matchedRulePaths: string[];
  evaluatedAt: number;
}

// Per-session write queue to serialize concurrent writes
const writeQueues = new Map<string, Promise<void>>();

// Allows tests to override the state directory
let stateDirOverride: string | null = null;

/** @internal Test-only: override the state directory */
export function _setStateDirForTesting(dir: string | null): void {
  stateDirOverride = dir;
}

export function resolveStateDir(): string {
  if (stateDirOverride !== null) {
    return stateDirOverride;
  }
  return path.join(os.homedir(), '.opencode', 'state', 'opencode-rules');
}

export function getStateFilePath(sessionId: string): string {
  return path.join(resolveStateDir(), `${sessionId}.json`);
}

export function writeActiveRulesState(
  sessionId: string,
  matchedPaths: string[]
): void {
  const state: ActiveRulesState = {
    sessionId,
    matchedRulePaths: matchedPaths,
    evaluatedAt: Date.now(),
  };

  // Chain onto existing queue for this session, or start fresh
  const previousWrite = writeQueues.get(sessionId) ?? Promise.resolve();

  const currentWrite = previousWrite.then(async () => {
    await doAtomicWrite(sessionId, state);
  });

  writeQueues.set(sessionId, currentWrite);

  // Fire-and-forget: catch errors to prevent unhandled rejection
  currentWrite.catch(() => {
    // Errors already logged in doAtomicWrite
  });
}

async function doAtomicWrite(
  sessionId: string,
  state: ActiveRulesState
): Promise<void> {
  const stateDir = resolveStateDir();
  const finalPath = getStateFilePath(sessionId);
  const tempPath = path.join(
    stateDir,
    `.${sessionId}-${crypto.randomBytes(8).toString('hex')}.tmp`
  );

  try {
    // Ensure directory exists
    await fs.mkdir(stateDir, { recursive: true });

    // Write to temp file
    const content = JSON.stringify(state);
    await fs.writeFile(tempPath, content, 'utf-8');

    // Atomic rename
    await fs.rename(tempPath, finalPath);
  } catch (error) {
    debugLog(
      `Failed to write active rules state for session ${sessionId}: ${error}`
    );

    // Clean up temp file if it exists
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

export async function readActiveRulesState(
  sessionId: string
): Promise<ActiveRulesState | null> {
  const filePath = getStateFilePath(sessionId);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(content);

    // Basic validation
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'sessionId' in parsed &&
      'matchedRulePaths' in parsed &&
      'evaluatedAt' in parsed
    ) {
      return parsed as ActiveRulesState;
    }

    debugLog(`Invalid active rules state format for session ${sessionId}`);
    return null;
  } catch (error) {
    debugLog(
      `Failed to read active rules state for session ${sessionId}: ${error}`
    );
    return null;
  }
}
