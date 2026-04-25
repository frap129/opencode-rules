import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { createDebugLog } from './debug.js';

const debugLog = createDebugLog();

export interface ActiveRulesState {
  sessionID: string;
  matchedRulePaths: string[];
  evaluatedAt: number;
}

// Per-session write queue to serialize concurrent writes
const writeQueues = new Map<string, Promise<void>>();

// Allows tests to override the state directory
let stateDirOverride: string | null = null;

// Strict pattern for safe sessionID: alphanumeric, underscore, hyphen only
const SAFE_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isValidSessionId(sessionID: string): boolean {
  return SAFE_SESSION_ID_PATTERN.test(sessionID);
}

/** @internal Test-only: override the state directory */
export function _setStateDirForTesting(dir: string | null): void {
  stateDirOverride = dir;
}

/** @internal Test-only: clear queued writes between tests */
export function _resetWriteQueues(): void {
  writeQueues.clear();
}

export function resolveStateDir(): string {
  if (stateDirOverride !== null) {
    return stateDirOverride;
  }
  return path.join(os.homedir(), '.opencode', 'state', 'opencode-rules');
}

export function getStateFilePath(sessionID: string): string {
  if (!isValidSessionId(sessionID)) {
    throw new Error(`Invalid sessionID: ${sessionID}`);
  }
  return path.join(resolveStateDir(), `${sessionID}.json`);
}

export function writeActiveRulesState(
  sessionID: string,
  matchedPaths: string[]
): Promise<void> {
  if (!isValidSessionId(sessionID)) {
    throw new Error(`Invalid sessionID: ${sessionID}`);
  }

  const state: ActiveRulesState = {
    sessionID,
    matchedRulePaths: matchedPaths,
    evaluatedAt: Date.now(),
  };

  // Chain onto existing queue for this session, or start fresh
  const previousWrite = writeQueues.get(sessionID) ?? Promise.resolve();

  const currentWrite = previousWrite.then(async () => {
    await doAtomicWrite(sessionID, state);
  });

  writeQueues.set(sessionID, currentWrite);

  return currentWrite;
}

async function doAtomicWrite(
  sessionID: string,
  state: ActiveRulesState
): Promise<void> {
  const stateDir = resolveStateDir();
  const finalPath = getStateFilePath(sessionID);
  const tempPath = path.join(
    stateDir,
    `.${sessionID}-${crypto.randomBytes(8).toString('hex')}.tmp`
  );

  try {
    // Atomic write: temp file + rename ensures crash safety
    await fs.mkdir(stateDir, { recursive: true });
    const content = JSON.stringify(state);
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, finalPath);
  } catch (error) {
    debugLog(
      `Failed to write active rules state for session ${sessionID}: ${error}`
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
  sessionID: string
): Promise<ActiveRulesState | null> {
  if (!isValidSessionId(sessionID)) {
    debugLog(`Invalid sessionID rejected: ${sessionID}`);
    return null;
  }

  const filePath = getStateFilePath(sessionID);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(content);

    if (!isValidActiveRulesState(parsed)) {
      debugLog(`Invalid active rules state format for session ${sessionID}`);
      return null;
    }

    return parsed;
  } catch (error) {
    debugLog(
      `Failed to read active rules state for session ${sessionID}: ${error}`
    );
    return null;
  }
}

function isValidActiveRulesState(value: unknown): value is ActiveRulesState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj['sessionID'] !== 'string') {
    return false;
  }

  if (typeof obj['evaluatedAt'] !== 'number') {
    return false;
  }

  if (!Array.isArray(obj['matchedRulePaths'])) {
    return false;
  }

  for (const item of obj['matchedRulePaths']) {
    if (typeof item !== 'string') {
      return false;
    }
  }

  return true;
}
