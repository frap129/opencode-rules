import path from 'node:path';

export interface ProjectDirData {
  session: {
    get(sessionID: string): { location?: { directory?: string } } | undefined;
  };
  location: {
    default(): { directory?: string };
  };
}

function pickProjectDir(
  ...candidates: Array<string | undefined | null>
): string | null {
  for (const candidate of candidates) {
    if (
      typeof candidate === 'string' &&
      candidate.length > 0 &&
      path.isAbsolute(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

// ctx.data.session.root() returns the family-root session ID, not a
// directory; the session's location directory is the project root.
export function projectDirFor(
  data: ProjectDirData,
  sessionID: string
): string | null {
  return pickProjectDir(
    data.session.get(sessionID)?.location?.directory,
    data.location.default().directory
  );
}
