import {
  extractFilePathsFromMessages,
  extractToolCallPaths,
} from './message-paths.js';
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
 * file paths used when determining Matched rules and retained across
 * compaction.
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
  /** Accumulate file paths from the current user message's parts. */
  recordMessageParts(sessionID: string, parts: readonly unknown[]): void;
  /** Accumulate the paths a live tool call observes. */
  recordToolCall(sessionID: string, toolName: string, args: unknown): void;
  /** Detached, deterministic view of observed paths for matching. */
  getPathsForMatching(sessionID: string): string[];
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

function extractWorkingContextPaths(
  messages: readonly MessageWithInfo[]
): string[] {
  return extractFilePathsFromMessages(
    filterValidMessages(
      messages.filter(
        (message): message is MessageWithInfo =>
          typeof message === 'object' && message !== null
      )
    )
  );
}

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

  const addPaths = (
    sessionID: string,
    workingContextPaths: readonly string[]
  ): void => {
    if (workingContextPaths.length === 0) return;
    sessionStore.upsert(sessionID, state => {
      for (const p of workingContextPaths) {
        state.workingContextPaths.add(
          normalizeContextPath(p, projectDirectory)
        );
      }
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
    const workingContextPaths = extractWorkingContextPaths(messages);
    sessionStore.upsert(sessionID, state => {
      for (const p of workingContextPaths) {
        state.workingContextPaths.add(
          normalizeContextPath(p, projectDirectory)
        );
      }
      state.workingContextSeeded = true;
    });
    if (workingContextPaths.length > 0) {
      debugLog(
        `Seeded ${workingContextPaths.length} Working-context path(s) for session ${sessionID}: ${workingContextPaths
          .slice(0, 5)
          .join(', ')}${workingContextPaths.length > 5 ? '...' : ''}`
      );
    }
    return true;
  };

  const recordMessageParts = (
    sessionID: string,
    parts: readonly unknown[]
  ): void => {
    if (!Array.isArray(parts) || parts.length === 0) return;
    addPaths(
      sessionID,
      extractFilePathsFromMessages([
        { role: 'user', parts: [...parts] as never[] },
      ])
    );
  };

  const recordToolCall = (
    sessionID: string,
    toolName: string,
    args: unknown
  ): void => {
    for (const filePath of extractToolCallPaths(toolName, args)) {
      const normalized = normalizeContextPath(filePath, projectDirectory);
      sessionStore.upsert(sessionID, state => {
        state.workingContextPaths.add(normalized);
      });
      debugLog(
        `Recorded Working-context path from tool ${toolName}: ${normalized}`
      );
    }
  };

  const getPathsForMatching = (sessionID: string): string[] => {
    return Array.from(
      sessionStore.get(sessionID)?.workingContextPaths ?? []
    ).sort(pathComparator);
  };

  const invalidateHistoryReads = (sessionID: string): void => {
    markHistoryRevision(sessionID);
    pendingHistoryPrefetch.delete(sessionID);
    inFlightReads.delete(sessionID);
  };

  const compactionProjection = (sessionID: string): string | undefined => {
    const workingContextPaths =
      sessionStore.get(sessionID)?.workingContextPaths;
    if (!workingContextPaths || workingContextPaths.size === 0)
      return undefined;

    const sortedPaths = Array.from(workingContextPaths).sort(pathComparator);
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
      addPaths(
        sessionID,
        extractWorkingContextPaths(
          settled.result.messages.filter(
            (message): message is MessageWithInfo =>
              typeof message === 'object' && message !== null
          )
        )
      );
      sessionStore.upsert(sessionID, state => {
        state.workingContextSeeded = true;
      });
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
      recordToolCall,
      getPathsForMatching,
      invalidateHistoryReads,
      prepareForCompaction: (sessionID: string): string | undefined => {
        invalidateHistoryReads(sessionID);
        return compactionProjection(sessionID);
      },
    },
    rawHistory,
  };
}
