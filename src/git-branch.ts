import { execFile, type ExecFileOptions } from 'node:child_process';

const GIT_TIMEOUT_MS = 5000;

export async function getGitBranch(projectDir: string): Promise<string | null> {
  try {
    const branch = await new Promise<string | null>(resolve => {
      const opts: ExecFileOptions = {
        cwd: projectDir,
        timeout: GIT_TIMEOUT_MS,
        killSignal: 'SIGTERM',
      };
      execFile(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        opts,
        (error, stdout) => {
          if (error) {
            resolve(null);
            return;
          }
          const trimmed = String(stdout).trim();
          if (!trimmed || trimmed === 'HEAD') {
            resolve(null);
            return;
          }
          resolve(trimmed);
        }
      );
    });
    return branch;
  } catch {
    return null;
  }
}
