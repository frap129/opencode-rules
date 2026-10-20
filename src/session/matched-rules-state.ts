import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { BoundedSessionMap } from '../shared/bounded-session-map.js';
import { createDebugLog, logWarning } from '../shared/debug.js';

const debugLog = createDebugLog();

export interface MatchedRulesState {
  sessionID: string;
  matchedRulePaths: string[];
  evaluatedAt: number;
}

interface MatchedRulesStateStoreOptions {
  stateDir?: string;
}

// Session IDs become filename components; this pattern gates what is accepted.
const SAFE_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isValidSessionID(sessionID: string): boolean {
  return SAFE_SESSION_ID_PATTERN.test(sessionID);
}

function resolveStateDir(): string {
  return path.join(os.homedir(), '.opencode', 'state', 'opencode-rules');
}

function buildStateFilePath(sessionID: string, stateDir: string): string {
  if (!isValidSessionID(sessionID)) {
    throw new Error(`Invalid sessionID: ${sessionID}`);
  }
  return path.join(stateDir, `${sessionID}.json`);
}

function samePaths(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export class MatchedRulesStateStore {
  private readonly stateDir: string;
  private readonly writeQueues = new Map<string, Promise<void>>();
  private readonly lastWrittenPaths = new BoundedSessionMap<{
    paths: readonly string[];
  }>({ max: 100 });

  constructor(opts: MatchedRulesStateStoreOptions = {}) {
    this.stateDir = opts.stateDir ?? resolveStateDir();
  }

  write(sessionID: string, matchedPaths: readonly string[]): Promise<void> {
    this.assertValidSessionID(sessionID);
    return this.enqueue(sessionID, async () => ({
      sessionID,
      matchedRulePaths: [...matchedPaths],
      evaluatedAt: Date.now(),
    }));
  }

  writeIfChanged(
    sessionID: string,
    matchedPaths: readonly string[]
  ): Promise<void> {
    this.assertValidSessionID(sessionID);
    return this.enqueue(sessionID, async () => {
      const cached = this.lastWrittenPaths.get(sessionID);
      if (cached && samePaths(cached.paths, matchedPaths)) {
        return null;
      }
      return {
        sessionID,
        matchedRulePaths: [...matchedPaths],
        evaluatedAt: Date.now(),
      };
    });
  }

  merge(sessionID: string, matchedPaths: readonly string[]): Promise<void> {
    this.assertValidSessionID(sessionID);
    return this.enqueue(sessionID, async () => {
      const existing = await readMatchedRulesState(sessionID, {
        stateDir: this.stateDir,
      });
      return {
        sessionID,
        matchedRulePaths: [
          ...new Set([...(existing?.matchedRulePaths ?? []), ...matchedPaths]),
        ],
        evaluatedAt: Date.now(),
      };
    });
  }

  private assertValidSessionID(sessionID: string): void {
    if (!isValidSessionID(sessionID)) {
      throw new Error(`Invalid sessionID: ${sessionID}`);
    }
  }

  // Each operation computes its state inside the queue so concurrent
  // merges cannot interleave read-modify-write.
  private enqueue(
    sessionID: string,
    operation: () => Promise<MatchedRulesState | null>
  ): Promise<void> {
    const previous = this.writeQueues.get(sessionID) ?? Promise.resolve();
    const current = previous
      .then(async () => {
        const state = await operation();
        if (state) {
          await this.doAtomicWrite(sessionID, state);
        }
      })
      .finally(() => {
        if (this.writeQueues.get(sessionID) === current) {
          this.writeQueues.delete(sessionID);
        }
      });
    this.writeQueues.set(sessionID, current);
    return current;
  }

  private async doAtomicWrite(
    sessionID: string,
    state: MatchedRulesState
  ): Promise<void> {
    const finalPath = buildStateFilePath(sessionID, this.stateDir);
    const tempPath = path.join(
      this.stateDir,
      `.${sessionID}-${crypto.randomBytes(8).toString('hex')}.tmp`
    );

    try {
      await fs.mkdir(this.stateDir, { recursive: true });
      const content = JSON.stringify(state);
      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, finalPath);
      this.lastWrittenPaths.ensure(sessionID, () => ({ paths: [] })).paths = [
        ...state.matchedRulePaths,
      ];
    } catch (error) {
      logWarning(
        `Failed to write matched rules state for session ${sessionID}`,
        error
      );

      try {
        await fs.unlink(tempPath);
      } catch {}
    }
  }
}

export async function readMatchedRulesState(
  sessionID: string,
  options: { stateDir?: string } = {}
): Promise<MatchedRulesState | null> {
  const filePath = buildStateFilePath(
    sessionID,
    options.stateDir ?? resolveStateDir()
  );

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(content);

    if (!isValidMatchedRulesState(parsed)) {
      debugLog(`Invalid matched rules state format for session ${sessionID}`);
      return null;
    }

    return parsed;
  } catch (error) {
    debugLog(
      `Failed to read matched rules state for session ${sessionID}: ${error}`
    );
    return null;
  }
}

function isValidMatchedRulesState(value: unknown): value is MatchedRulesState {
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
