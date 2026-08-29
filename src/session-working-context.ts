import {
  extractObservationsFromMessageParts,
  type FileObservation,
} from './file-observation.js';
import {
  normalizeContextPath,
  sanitizePathForContext,
  filterValidMessages,
  type MessageWithInfo,
} from './message-context.js';
import type { RawHistoryResult } from './rule-delivery-history.js';
import type { SessionStore } from './session-store.js';
import type { DebugLog } from './debug.js';

/** Prefetched history entries are consumed by the first durable turn; a
 * transform-first seed can leave them unconsumed. A small bound keeps the
 * worst case (full histories per session) negligible. */
const MAX_PENDING_HISTORY_PREFETCH = 8;

const COMPACT_PROJECTION_MAX_PATHS = 20;

/**
 * Runtime-owned per-session Working context: the monotonic set of observed
 * file paths retained for compaction projection. It is rebuilt from eligible
 * history parts but is never a Rule-matching source; live File observations
 * in the separate FileObservationContext are the only matching input.
 */
export interface WorkingContext {
  /** Seed from the supplied transform messages. First successful source
   * wins, including a successful empty message set. Returns true when this
   * call performed the seeding. */
  seedFromSuppliedMessages(
    sessionID: string,
    messages: readonly MessageWithInfo[]
  ): boolean;
  /** Prepare a durable turn: seed from fetched history when unseeded.
   * Concurrent preparation for one session shares one in-flight read, and
   * a settled read seeds at most once for its generation. */
  prepareDurableTurn(sessionID: string): Promise<void>;
  /** Accumulate paths from the current user message's tool parts. */
  recordMessageParts(sessionID: string, parts: readonly unknown[]): void;
  /** Accumulate paths from already normalized observations. */
  recordObservations(
    sessionID: string,
    observations: readonly FileObservation[]
  ): void;
  /** Invalidate in-flight and prefetched history reads for the session.
   * Observed paths are never subtracted. */
  invalidateHistoryReads(sessionID: string): void;
  /** Invalidate history reads and return the optional compaction projection. */
  prepareForCompaction(sessionID: string): string | undefined;
}

/** Construction returns two narrow facets backed by one implementation:
 * the runtime learns Working-context operations, RuleDelivery only learns
 * raw-history reads. */
export interface SessionWorkingContext {
  workingContext: WorkingContext;
  rawHistory: { readHistory(sessionID: string): Promise<RawHistoryResult> };
}

export interface SessionWorkingContextOptions {
  sessionStore: SessionStore;
  projectDirectory: string;
  readHistory: (sessionID: string) => Promise<RawHistoryResult>;
  debugLog: DebugLog;
}

const pathComparator = (a: string, b: string) => a.localeCompare(b);

interface SettledRead {
  revision: number;
  result: RawHistoryResult;
}

export function createSessionWorkingContext(
  opts: SessionWorkingContextOptions
): SessionWorkingContext {
  const { sessionStore, projectDirectory, readHistory, debugLog } = opts;

  /** Completed, unconsumed history reads retained once for RuleDelivery. */
  const pendingHistoryPrefetch = new Map<string, RawHistoryResult>();
  /** Bumped on message removal and compaction so settled reads from before
   * the invalidation can no longer apply. */
  const historyRevisions = new Map<string, number>();
  /** Shared in-flight reads, keyed by session. */
  const inFlightReads = new Map<string, Promise<SettledRead>>();

  const addObservations = (
    sessionID: string,
    observations: readonly FileObservation[],
    markSeeded = false
  ): void => {
    if (observations.length === 0 && !markSeeded) return;
    sessionStore.upsert(sessionID, state => {
      for (const observation of observations) {
        state.workingContextPaths.add(
          normalizeContextPath(observation.path, projectDirectory)
        );
      }
      if (markSeeded) state.workingContextSeeded = true;
    });
  };

  const markHistoryRevision = (sessionID: string): number => {
    const next = (historyRevisions.get(sessionID) ?? 0) + 1;
    historyRevisions.set(sessionID, next);
    return next;
  };

  const readClientHistory = async (sessionID: string): Promise<SettledRead> => {
    const revision = historyRevisions.get(sessionID) ?? 0;
    const read = readHistory(sessionID).then(
      result => ({ revision, result }),
      error => {
        debugLog(`Failed to fetch session history for ${sessionID}: ${error}`);
        return { revision, result: { ok: false } as RawHistoryResult };
      }
    );
    inFlightReads.set(sessionID, read);
    void read.finally(() => {
      if (inFlightReads.get(sessionID) === read) {
        inFlightReads.delete(sessionID);
      }
    });
    return read;
  };

  const seeded = (sessionID: string): boolean =>
    sessionStore.get(sessionID)?.workingContextSeeded === true;

  const seedFromSuppliedMessages = (
    sessionID: string,
    messages: readonly MessageWithInfo[]
  ): boolean => {
    if (seeded(sessionID)) return false;
    const observations = extractObservationsFromSuppliedMessages(messages);
    addObservations(sessionID, observations, true);
    if (observations.length > 0) {
      debugLog(
        `Seeded ${observations.length} Working-context observation(s) for session ${sessionID}: ${observations
          .slice(0, 5)
          .map(o => o.path)
          .join(', ')}${observations.length > 5 ? '...' : ''}`
      );
    }
    return true;
  };

  const recordMessageParts = (
    sessionID: string,
    parts: readonly unknown[]
  ): void => {
    if (!Array.isArray(parts) || parts.length === 0) return;
    addObservations(
      sessionID,
      extractObservationsFromMessageParts(
        parts.filter(
          part =>
            typeof part === 'object' &&
            part !== null &&
            !((part as { synthetic?: boolean }).synthetic === true)
        )
      )
    );
  };

  const invalidateHistoryReads = (sessionID: string): void => {
    markHistoryRevision(sessionID);
    pendingHistoryPrefetch.delete(sessionID);
    inFlightReads.delete(sessionID);
  };

  const compactionProjection = (sessionID: string): string | undefined => {
    const paths = Array.from(
      sessionStore.get(sessionID)?.workingContextPaths ?? []
    );
    if (paths.length === 0) return undefined;

    const sortedPaths = [...paths].sort(pathComparator);
    const pathsToInclude = sortedPaths.slice(0, COMPACT_PROJECTION_MAX_PATHS);
    return [
      'OpenCode Rules: Working context',
      'Current file paths in context:',
      ...pathsToInclude.map(p => `  - ${sanitizePathForContext(p)}`),
      ...(sortedPaths.length > COMPACT_PROJECTION_MAX_PATHS
        ? [
            `  ... and ${sortedPaths.length - COMPACT_PROJECTION_MAX_PATHS} more paths`,
          ]
        : []),
    ].join('\n');
  };

  const storePrefetch = (sessionID: string, result: RawHistoryResult): void => {
    pendingHistoryPrefetch.delete(sessionID);
    pendingHistoryPrefetch.set(sessionID, result);
    while (pendingHistoryPrefetch.size > MAX_PENDING_HISTORY_PREFETCH) {
      const oldest = pendingHistoryPrefetch.keys().next().value;
      if (oldest === undefined) break;
      pendingHistoryPrefetch.delete(oldest);
    }
  };

  async function prepareDurableTurn(sessionID: string): Promise<void> {
    if (seeded(sessionID)) return;

    const existing = inFlightReads.get(sessionID);
    const settled = existing
      ? await existing
      : await readClientHistory(sessionID);

    const currentRevision = historyRevisions.get(sessionID) ?? 0;
    if (currentRevision !== settled.revision) {
      // The read was invalidated by message removal or compaction after it
      // started: it may not seed Working context or refill the prefetch.
      return;
    }
    if (seeded(sessionID)) {
      // A concurrent caller already applied this generation's result.
      return;
    }

    storePrefetch(sessionID, settled.result);
    if (settled.result.ok) {
      addObservations(
        sessionID,
        extractObservationsFromSuppliedMessages(
          settled.result.messages as MessageWithInfo[]
        ),
        true
      );
    }
  }

  const rawHistory = {
    readHistory: async (sessionID: string): Promise<RawHistoryResult> => {
      const cached = pendingHistoryPrefetch.get(sessionID);
      if (cached) {
        pendingHistoryPrefetch.delete(sessionID);
        return cached;
      }
      return readHistory(sessionID);
    },
  };

  return {
    workingContext: {
      seedFromSuppliedMessages,
      prepareDurableTurn,
      recordMessageParts,
      recordObservations: (sessionID, observations) =>
        addObservations(sessionID, observations),
      invalidateHistoryReads,
      prepareForCompaction: (sessionID: string): string | undefined => {
        invalidateHistoryReads(sessionID);
        return compactionProjection(sessionID);
      },
    },
    rawHistory,
  };
}

function extractObservationsFromSuppliedMessages(
  messages: readonly MessageWithInfo[]
): FileObservation[] {
  const result: FileObservation[] = [];
  for (const message of filterValidMessages(
    messages.filter(
      (message): message is MessageWithInfo =>
        typeof message === 'object' && message !== null
    )
  )) {
    result.push(...extractObservationsFromMessageParts(message.parts));
  }
  return result;
}
