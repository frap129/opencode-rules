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

// Strict pattern for safe sessionId: alphanumeric, underscore, hyphen only
const SAFE_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isValidSessionId(sessionId: string): boolean {
  return SAFE_SESSION_ID_PATTERN.test(sessionId);
}

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
  if (!isValidSessionId(sessionId)) {
    throw new Error(`Invalid sessionId: ${sessionId}`);
  }
  return path.join(resolveStateDir(), `${sessionId}.json`);
}

export function writeActiveRulesState(
  sessionId: string,
  matchedPaths: string[]
): void {
  if (!isValidSessionId(sessionId)) {
    debugLog(`Invalid sessionId rejected: ${sessionId}`);
    return;
  }

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
  if (!isValidSessionId(sessionId)) {
    debugLog(`Invalid sessionId rejected: ${sessionId}`);
    return null;
  }

  const filePath = getStateFilePath(sessionId);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(content);

    if (!isValidActiveRulesState(parsed)) {
      debugLog(`Invalid active rules state format for session ${sessionId}`);
      return null;
    }

    return parsed;
  } catch (error) {
    debugLog(
      `Failed to read active rules state for session ${sessionId}: ${error}`
    );
    return null;
  }
}

function isValidActiveRulesState(value: unknown): value is ActiveRulesState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj['sessionId'] !== 'string') {
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
