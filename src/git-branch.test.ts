import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'child_process';

import { getGitBranch } from './git-branch.js';

vi.mock('child_process');

const mockedExecFile = vi.mocked(childProcess.execFile);

type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string
) => void;

describe('getGitBranch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls execFile with git binary and correct argv', async () => {
    mockedExecFile.mockImplementation((file, args, _opts, callback) => {
      expect(file).toBe('git');
      expect(args).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
      (callback as ExecFileCallback)(null, 'main\n', '');
      return {} as childProcess.ChildProcess;
    });

    await getGitBranch('/project');
    expect(mockedExecFile).toHaveBeenCalledTimes(1);
  });

  it('passes cwd, timeout, and killSignal in options', async () => {
    mockedExecFile.mockImplementation((_file, _args, opts, callback) => {
      const options = opts as childProcess.ExecFileOptions;
      expect(options.cwd).toBe('/my/project/dir');
      expect(options.timeout).toBe(5000);
      expect(options.killSignal).toBe('SIGTERM');
      (callback as ExecFileCallback)(null, 'main\n', '');
      return {} as childProcess.ChildProcess;
    });

    await getGitBranch('/my/project/dir');
  });

  it('returns current branch name when git succeeds', async () => {
    mockedExecFile.mockImplementation((_file, _args, _opts, callback) => {
      (callback as ExecFileCallback)(null, 'main\n', '');
      return {} as childProcess.ChildProcess;
    });

    const branch = await getGitBranch('/project');
    expect(branch).toBe('main');
  });

  it('returns undefined if not a git repository', async () => {
    mockedExecFile.mockImplementation((_file, _args, _opts, callback) => {
      const error = new Error('fatal: not a git repository');
      (callback as ExecFileCallback)(error, '', 'fatal: not a git repository');
      return {} as childProcess.ChildProcess;
    });

    const branch = await getGitBranch('/not-a-repo');
    expect(branch).toBeUndefined();
  });

  it('returns undefined if command fails', async () => {
    mockedExecFile.mockImplementation((_file, _args, _opts, callback) => {
      const error = new Error('Command failed');
      (callback as ExecFileCallback)(error, '', '');
      return {} as childProcess.ChildProcess;
    });

    const branch = await getGitBranch('/project');
    expect(branch).toBeUndefined();
  });

  it('returns undefined for detached HEAD state', async () => {
    mockedExecFile.mockImplementation((_file, _args, _opts, callback) => {
      (callback as ExecFileCallback)(null, 'HEAD\n', '');
      return {} as childProcess.ChildProcess;
    });

    const branch = await getGitBranch('/project');
    expect(branch).toBeUndefined();
  });

  it('trims stdout whitespace', async () => {
    mockedExecFile.mockImplementation((_file, _args, _opts, callback) => {
      (callback as ExecFileCallback)(null, '  feature/test  \n', '');
      return {} as childProcess.ChildProcess;
    });

    const branch = await getGitBranch('/project');
    expect(branch).toBe('feature/test');
  });

  it('tolerates stderr noise when stdout is valid', async () => {
    mockedExecFile.mockImplementation((_file, _args, _opts, callback) => {
      (callback as ExecFileCallback)(null, 'develop\n', 'warning: some noise');
      return {} as childProcess.ChildProcess;
    });

    const branch = await getGitBranch('/project');
    expect(branch).toBe('develop');
  });

  it('returns undefined when stdout is empty', async () => {
    mockedExecFile.mockImplementation((_file, _args, _opts, callback) => {
      (callback as ExecFileCallback)(null, '', '');
      return {} as childProcess.ChildProcess;
    });

    const branch = await getGitBranch('/project');
    expect(branch).toBeUndefined();
  });

  it('returns undefined when stdout is only whitespace', async () => {
    mockedExecFile.mockImplementation((_file, _args, _opts, callback) => {
      (callback as ExecFileCallback)(null, '   \n\t  ', '');
      return {} as childProcess.ChildProcess;
    });

    const branch = await getGitBranch('/project');
    expect(branch).toBeUndefined();
  });

  it('never throws on unexpected errors', async () => {
    mockedExecFile.mockImplementation(() => {
      throw new Error('Unexpected sync error');
    });

    const branch = await getGitBranch('/project');
    expect(branch).toBeUndefined();
  });
});
