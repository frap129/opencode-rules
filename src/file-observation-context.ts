import {
  normalizeObservations,
  type FileObservation,
} from './file-observation.js';
import type { RawToolEvent } from './file-observation.js';
import { normalizeContextPath } from './message-context.js';
import { BoundedSessionMap } from './bounded-session-map.js';

interface ObservationSession {
  observations: FileObservation[];
}

interface FileObservationContextOptions {
  projectDirectory: string;
  maxSessions?: number;
}

// Live `tool.execute.after` observations are the sole matching source, so
// this store is retained monotonically — including repeated paths — for
// the resident session.
export interface FileObservationContext {
  recordToolEvent(sessionID: string, event: RawToolEvent): FileObservation[];
  recordObservations(
    sessionID: string,
    observations: readonly FileObservation[]
  ): void;
  getForMatching(sessionID: string): FileObservation[];
}

const pathComparator = (a: FileObservation, b: FileObservation): number =>
  a.path.localeCompare(b.path);

export function createFileObservationContext(
  options: FileObservationContextOptions
): FileObservationContext {
  const sessions = new BoundedSessionMap<ObservationSession>({
    minBound: 1,
    max: options.maxSessions ?? 100,
  });

  const getSession = (sessionID: string): ObservationSession => {
    return sessions.ensure(sessionID, () => ({ observations: [] }));
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
      const session = sessions.touch(sessionID);
      if (!session) return [];
      return session.observations
        .map(observation => ({ ...observation }))
        .sort(pathComparator);
    },
  };
}
