import { execFile, type ExecFileOptions } from 'node:child_process';
import { createDebugLog } from './debug.js';

const debugLog = createDebugLog();
const GIT_TIMEOUT_MS = 5000;

export async function getGitBranch(
  projectDir: string,
  execFn: typeof execFile = execFile
): Promise<string | null> {
  try {
    const branch = await new Promise<string | null>(resolve => {
      const opts: ExecFileOptions = {
        cwd: projectDir,
        timeout: GIT_TIMEOUT_MS,
        killSignal: 'SIGTERM',
      };
      execFn(
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
  } catch (err) {
    debugLog(`Failed to get git branch: ${err}`);
    return null;
  }
}
