import { execFile, type ExecFileOptions } from 'child_process';

const GIT_TIMEOUT_MS = 5000;

export async function getGitBranch(
  projectDir: string
): Promise<string | undefined> {
  try {
    const branch = await new Promise<string | undefined>(resolve => {
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
            resolve(undefined);
            return;
          }
          const trimmed = String(stdout).trim();
          if (!trimmed || trimmed === 'HEAD') {
            resolve(undefined);
            return;
          }
          resolve(trimmed);
        }
      );
    });
    return branch;
  } catch {
    return undefined;
  }
}
