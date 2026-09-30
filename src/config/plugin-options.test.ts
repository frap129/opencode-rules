import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import {
  parsePluginOptions,
  resolveAdditionalRuleDirectories,
} from './plugin-options.js';
import {
  restoreEnv,
  saveEnv,
  setupTestDirs,
  teardownTestDirs,
  type EnvSnapshot,
} from '../test-fixtures.js';

describe('parsePluginOptions', () => {
  it('reports no directories when options are absent', () => {
    expect(parsePluginOptions(undefined)).toEqual({
      additionalRuleDirectories: [],
    });
    expect(parsePluginOptions({})).toEqual({ additionalRuleDirectories: [] });
    expect(parsePluginOptions({ additionalRuleDirectories: [] })).toEqual({
      additionalRuleDirectories: [],
    });
  });

  it('accepts a single string', () => {
    expect(
      parsePluginOptions({ additionalRuleDirectories: '~/my-rules' })
    ).toEqual({ additionalRuleDirectories: ['~/my-rules'] });
  });

  it('accepts an array of strings', () => {
    expect(
      parsePluginOptions({
        additionalRuleDirectories: ['/abs/rules', '.agents/rules'],
      })
    ).toEqual({
      additionalRuleDirectories: ['/abs/rules', '.agents/rules'],
    });
  });

  it('trims entries and drops blanks', () => {
    expect(
      parsePluginOptions({
        additionalRuleDirectories: [
          '  /abs/rules  ',
          '',
          '   ',
          '\t/tmp/rules\n',
        ],
      })
    ).toEqual({
      additionalRuleDirectories: ['/abs/rules', '/tmp/rules'],
    });
  });

  it('drops non-string values and non-string entries', () => {
    expect(
      parsePluginOptions({
        additionalRuleDirectories: [
          42,
          null,
          { dir: '/abs' },
          ['nested'],
          'keep',
        ],
      })
    ).toEqual({ additionalRuleDirectories: ['keep'] });
  });

  it('falls back to no directories when the option is the wrong type', () => {
    expect(parsePluginOptions({ additionalRuleDirectories: 42 })).toEqual({
      additionalRuleDirectories: [],
    });
    expect(
      parsePluginOptions({ additionalRuleDirectories: { dir: '/abs' } })
    ).toEqual({ additionalRuleDirectories: [] });
  });

  it('ignores unrelated options', () => {
    expect(parsePluginOptions({ debug: true })).toEqual({
      additionalRuleDirectories: [],
    });
  });

  it('never throws on malformed input', () => {
    const hostile = {};
    Object.defineProperty(hostile, 'additionalRuleDirectories', {
      get() {
        throw new Error('boom');
      },
    });

    expect(parsePluginOptions(hostile)).toEqual({
      additionalRuleDirectories: [],
    });
    // The host types options as an object, but nothing stops a hand-written
    // config from supplying something else.
    const notAnObject = null as unknown as Readonly<Record<string, unknown>>;
    expect(parsePluginOptions(notAnObject)).toEqual({
      additionalRuleDirectories: [],
    });

    // Reading an array entry runs a getter too, and the invariant holds there
    // as well.
    const hostileEntries: unknown[] = [];
    Object.defineProperty(hostileEntries, '0', {
      get() {
        throw new Error('boom');
      },
    });
    expect(
      parsePluginOptions({ additionalRuleDirectories: hostileEntries })
    ).toEqual({ additionalRuleDirectories: [] });
  });
});

describe('resolveAdditionalRuleDirectories', () => {
  let envSnapshot: EnvSnapshot;
  let testDir: string;

  beforeEach(() => {
    testDir = setupTestDirs().testDir;
    envSnapshot = saveEnv('HOME');
  });

  afterEach(() => {
    teardownTestDirs();
    restoreEnv(envSnapshot);
  });

  it('expands a leading ~ using HOME', () => {
    process.env.HOME = path.join(testDir, 'home');

    expect(resolveAdditionalRuleDirectories(['~/my-rules'], null)).toEqual([
      path.join(testDir, 'home', 'my-rules'),
    ]);
    expect(resolveAdditionalRuleDirectories(['~'], null)).toEqual([
      path.join(testDir, 'home'),
    ]);
  });

  it('falls back to os.homedir() when HOME is unset', () => {
    delete process.env.HOME;

    expect(resolveAdditionalRuleDirectories(['~/my-rules'], null)).toEqual([
      path.join(os.homedir(), 'my-rules'),
    ]);
  });

  it('leaves ~user paths relative to the project directory', () => {
    const projectDir = path.join(testDir, 'project');

    expect(
      resolveAdditionalRuleDirectories(['~alice/my-rules'], projectDir)
    ).toEqual([path.join(projectDir, '~alice', 'my-rules')]);
  });

  it('passes absolute entries through, normalized', () => {
    expect(
      resolveAdditionalRuleDirectories(
        ['/abs/rules', '/abs/other/../rules'],
        null
      )
    ).toEqual(['/abs/rules']);
  });

  it('resolves relative entries against the project directory', () => {
    const projectDir = path.join(testDir, 'project');

    expect(
      resolveAdditionalRuleDirectories(['.agents/rules'], projectDir)
    ).toEqual([path.join(projectDir, '.agents', 'rules')]);
  });

  it('skips relative entries when there is no project directory', () => {
    expect(
      resolveAdditionalRuleDirectories(['.agents/rules', '/abs/rules'], null)
    ).toEqual(['/abs/rules']);
    // An empty project directory must not silently fall back to process.cwd().
    expect(resolveAdditionalRuleDirectories(['.agents/rules'], '')).toEqual([]);
  });

  it('dedupes entries resolving to the same directory, keeping user order', () => {
    process.env.HOME = path.join(testDir, 'home');
    const projectDir = path.join(testDir, 'project');

    expect(
      resolveAdditionalRuleDirectories(
        ['~/rules', '/abs/rules', '.agents/rules', './.agents/rules'],
        projectDir
      )
    ).toEqual([
      path.join(testDir, 'home', 'rules'),
      '/abs/rules',
      path.join(projectDir, '.agents', 'rules'),
    ]);
  });

  it('returns nothing for an empty entry list', () => {
    expect(resolveAdditionalRuleDirectories([], null)).toEqual([]);
  });
});
