import { describe, expect, it } from 'vitest';
import { projectDirFor, type ProjectDirData } from './project-dir.js';

function fakeData(
  sessionDir: string | undefined,
  defaultDir: string
): ProjectDirData {
  return {
    session: {
      get: () =>
        sessionDir === undefined
          ? undefined
          : { location: { directory: sessionDir } },
    },
    location: { default: () => ({ directory: defaultDir }) },
  };
}

describe('projectDirFor', () => {
  it('uses the session location directory', () => {
    expect(
      projectDirFor(fakeData('/work/proj', '/work/default'), 'ses_1')
    ).toBe('/work/proj');
  });

  it('falls back to the default location when the session is unknown', () => {
    expect(
      projectDirFor(fakeData(undefined, '/work/default'), 'ses_missing')
    ).toBe('/work/default');
  });

  it('rejects a session ID used as a directory (regression)', () => {
    expect(
      projectDirFor(fakeData('ses_2bab1d58ffe', '/work/default'), 'ses_1')
    ).toBe('/work/default');
  });

  it('rejects relative, empty, and non-string directories', () => {
    expect(projectDirFor(fakeData('', '/work/default'), 'ses_1')).toBe(
      '/work/default'
    );
    expect(
      projectDirFor(
        fakeData('relative/dir' as string, '/work/default'),
        'ses_1'
      )
    ).toBe('/work/default');
  });

  it('returns null when no candidate is an absolute path', () => {
    expect(projectDirFor(fakeData(undefined, ''), 'ses_1')).toBeNull();
    expect(projectDirFor(fakeData(undefined, 'relative'), 'ses_1')).toBeNull();
  });
});
