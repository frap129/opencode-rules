import { describe, it, expect, vi } from 'vitest';
import type { execFile } from 'node:child_process';

import { getGitBranch } from './git-branch.js';

type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string
) => void;

describe('getGitBranch', () => {
  it('calls execFile with git binary and correct argv', async () => {
    const mockExecFile = vi
      .fn()
      .mockImplementation((file, args, _opts, callback) => {
        expect(file).toBe('git');
        expect(args).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
        (callback as ExecFileCallback)(null, 'main\n', '');
        return {} as ReturnType<typeof execFile>;
      });

    await getGitBranch('/project', mockExecFile as unknown as typeof execFile);
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('passes cwd, timeout, and killSignal in options', async () => {
    const mockExecFile = vi
      .fn()
      .mockImplementation((_file, _args, opts, callback) => {
        expect(opts.cwd).toBe('/my/project/dir');
        expect(opts.timeout).toBe(5000);
        expect(opts.killSignal).toBe('SIGTERM');
        (callback as ExecFileCallback)(null, 'main\n', '');
        return {} as ReturnType<typeof execFile>;
      });

    await getGitBranch(
      '/my/project/dir',
      mockExecFile as unknown as typeof execFile
    );
  });

  it('returns current branch name when git succeeds', async () => {
    const mockExecFile = vi
      .fn()
      .mockImplementation((_file, _args, _opts, callback) => {
        (callback as ExecFileCallback)(null, 'main\n', '');
        return {} as ReturnType<typeof execFile>;
      });

    const branch = await getGitBranch(
      '/project',
      mockExecFile as unknown as typeof execFile
    );
    expect(branch).toBe('main');
  });

  it('returns null if not a git repository', async () => {
    const mockExecFile = vi
      .fn()
      .mockImplementation((_file, _args, _opts, callback) => {
        const error = new Error('fatal: not a git repository');
        (callback as ExecFileCallback)(
          error,
          '',
          'fatal: not a git repository'
        );
        return {} as ReturnType<typeof execFile>;
      });

    const branch = await getGitBranch(
      '/not-a-repo',
      mockExecFile as unknown as typeof execFile
    );
    expect(branch).toBeNull();
  });

  it('returns null if command fails', async () => {
    const mockExecFile = vi
      .fn()
      .mockImplementation((_file, _args, _opts, callback) => {
        const error = new Error('Command failed');
        (callback as ExecFileCallback)(error, '', '');
        return {} as ReturnType<typeof execFile>;
      });

    const branch = await getGitBranch(
      '/project',
      mockExecFile as unknown as typeof execFile
    );
    expect(branch).toBeNull();
  });

  it('returns null for detached HEAD state', async () => {
    const mockExecFile = vi
      .fn()
      .mockImplementation((_file, _args, _opts, callback) => {
        (callback as ExecFileCallback)(null, 'HEAD\n', '');
        return {} as ReturnType<typeof execFile>;
      });

    const branch = await getGitBranch(
      '/project',
      mockExecFile as unknown as typeof execFile
    );
    expect(branch).toBeNull();
  });

  it('trims stdout whitespace', async () => {
    const mockExecFile = vi
      .fn()
      .mockImplementation((_file, _args, _opts, callback) => {
        (callback as ExecFileCallback)(null, '  feature/test  \n', '');
        return {} as ReturnType<typeof execFile>;
      });

    const branch = await getGitBranch(
      '/project',
      mockExecFile as unknown as typeof execFile
    );
    expect(branch).toBe('feature/test');
  });

  it('tolerates stderr noise when stdout is valid', async () => {
    const mockExecFile = vi
      .fn()
      .mockImplementation((_file, _args, _opts, callback) => {
        (callback as ExecFileCallback)(
          null,
          'develop\n',
          'warning: some noise'
        );
        return {} as ReturnType<typeof execFile>;
      });

    const branch = await getGitBranch(
      '/project',
      mockExecFile as unknown as typeof execFile
    );
    expect(branch).toBe('develop');
  });

  it('returns null when stdout is empty', async () => {
    const mockExecFile = vi
      .fn()
      .mockImplementation((_file, _args, _opts, callback) => {
        (callback as ExecFileCallback)(null, '', '');
        return {} as ReturnType<typeof execFile>;
      });

    const branch = await getGitBranch(
      '/project',
      mockExecFile as unknown as typeof execFile
    );
    expect(branch).toBeNull();
  });

  it('returns null when stdout is only whitespace', async () => {
    const mockExecFile = vi
      .fn()
      .mockImplementation((_file, _args, _opts, callback) => {
        (callback as ExecFileCallback)(null, '   \n\t  ', '');
        return {} as ReturnType<typeof execFile>;
      });

    const branch = await getGitBranch(
      '/project',
      mockExecFile as unknown as typeof execFile
    );
    expect(branch).toBeNull();
  });

  it('never throws on unexpected errors', async () => {
    const mockExecFile = vi.fn().mockImplementation(() => {
      throw new Error('Unexpected sync error');
    });

    const branch = await getGitBranch(
      '/project',
      mockExecFile as unknown as typeof execFile
    );
    expect(branch).toBeNull();
  });
});
