import {
  normalizeObservations,
  type FileObservation,
} from './file-observation.js';
import type { RawToolEvent } from './file-observation.js';
import { normalizeContextPath } from './message-context.js';

interface ObservationSession {
  observations: FileObservation[];
  lastUpdated: number;
}

interface FileObservationContextOptions {
  projectDirectory: string;
  maxSessions?: number;
}

/**
 * Runtime-owned per-session store of File observations. Populated only by
 * live successful `tool.execute.after` events and retained monotonically —
 * including repeated paths — for the resident session.
 */
export interface FileObservationContext {
  /** Normalize one live event, record it, and return the stored copies. */
  recordToolEvent(sessionID: string, event: RawToolEvent): FileObservation[];
  /** Record already normalized observations. */
  recordObservations(
    sessionID: string,
    observations: readonly FileObservation[]
  ): void;
  /** Sorted, detached copies for rule matching. */
  getForMatching(sessionID: string): FileObservation[];
}

const pathComparator = (a: FileObservation, b: FileObservation): number =>
  a.path.localeCompare(b.path);

export function createFileObservationContext(
  options: FileObservationContextOptions
): FileObservationContext {
  const sessions = new Map<string, ObservationSession>();
  const maxSessions = Math.max(1, options.maxSessions ?? 100);
  let tick = 0;

  const getSession = (sessionID: string): ObservationSession => {
    let session = sessions.get(sessionID);
    if (!session) {
      session = { observations: [], lastUpdated: 0 };
      sessions.set(sessionID, session);
    }
    session.lastUpdated = ++tick;
    while (sessions.size > maxSessions) {
      let oldestID: string | undefined;
      let oldestUpdate = Infinity;
      for (const [id, candidate] of sessions) {
        if (candidate.lastUpdated < oldestUpdate) {
          oldestID = id;
          oldestUpdate = candidate.lastUpdated;
        }
      }
      if (!oldestID) break;
      sessions.delete(oldestID);
    }
    return session;
  };

  const normalizeForContext = (
    observation: FileObservation
  ): FileObservation => ({
    ...observation,
    path: normalizeContextPath(observation.path, options.projectDirectory),
  });

  const recordNormalized = (
    sessionID: string,
    observations: readonly FileObservation[]
  ): void => {
    if (observations.length === 0) return;
    const session = getSession(sessionID);
    session.observations.push(...observations);
  };

  return {
    recordToolEvent: (sessionID, event) => {
      const observations =
        normalizeObservations(event).map(normalizeForContext);
      recordNormalized(sessionID, observations);
      return observations;
    },
    recordObservations: (sessionID, observations) => {
      recordNormalized(sessionID, observations.map(normalizeForContext));
    },
    getForMatching: sessionID => {
      const session = sessions.get(sessionID);
      if (!session) return [];
      session.lastUpdated = ++tick;
      return session.observations
        .map(observation => ({ ...observation }))
        .sort(pathComparator);
    },
  };
}
