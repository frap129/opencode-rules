import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import {
  loadRuleSnapshots,
  getCachedRule,
  clearRuleCache,
  discoverRuleFiles,
} from './rule-discovery.js';
import {
  restoreEnv,
  saveEnv,
  setupTestDirs,
  teardownTestDirs,
  type EnvSnapshot,
} from '../test-fixtures.js';

describe('loadRuleSnapshots', () => {
  afterEach(teardownTestDirs);

  it('captures metadata and stripped content in discovery order', async () => {
    const { globalRulesDir } = setupTestDirs();
    const first = path.join(globalRulesDir, 'a.mdc');
    const second = path.join(globalRulesDir, 'b.md');
    writeFileSync(first, `---\nagent: [plan]\n---\n\nbody`);
    writeFileSync(second, 'second body');

    const snapshots = await loadRuleSnapshots([
      { filePath: first, relativePath: 'a.mdc' },
      { filePath: second, relativePath: 'b.md' },
    ]);

    expect(snapshots.map(rule => rule.relativePath)).toEqual(['a.mdc', 'b.md']);
    expect(snapshots[0]?.metadata).toEqual({ agent: ['plan'] });
    expect(snapshots[0]?.strippedContent).toBe('body');
  });

  it('skips unreadable rules without dropping the rest', async () => {
    const { globalRulesDir } = setupTestDirs();
    const missing = path.join(globalRulesDir, 'missing.md');
    const valid = path.join(globalRulesDir, 'valid.md');
    writeFileSync(valid, '# Valid Rule');

    const snapshots = await loadRuleSnapshots([
      { filePath: missing, relativePath: 'missing.md' },
      { filePath: valid, relativePath: 'valid.md' },
    ]);

    expect(snapshots.map(rule => rule.relativePath)).toEqual(['valid.md']);
  });
});

describe('rule content caching (live delivery loader)', () => {
  beforeEach(() => {
    clearRuleCache();
  });

  afterEach(teardownTestDirs);

  it('serves identical content from cache across repeated reads', async () => {
    const { globalRulesDir } = setupTestDirs();
    const rulePath = path.join(globalRulesDir, 'cached.md');
    writeFileSync(rulePath, '# Cached Rule\nStable body.');

    const first = await getCachedRule(rulePath);
    const second = await getCachedRule(rulePath);

    expect(first?.content).toContain('Cached Rule');
    expect(second).toBe(first);
  });

  it('invalidates the cache when the file mtime changes', async () => {
    const { globalRulesDir } = setupTestDirs();
    const rulePath = path.join(globalRulesDir, 'mutable.md');
    writeFileSync(rulePath, '# Original Content');

    const before = await getCachedRule(rulePath);
    expect(before?.strippedContent).toContain('Original Content');

    writeFileSync(rulePath, '# Modified Content');
    // Force a future mtime so invalidation does not depend on filesystem
    // timestamp granularity (flaky on CI/coarse clocks).
    const futureTime = new Date(Date.now() + 2000);
    utimesSync(rulePath, futureTime, futureTime);

    const after = await getCachedRule(rulePath);
    expect(after?.strippedContent).toContain('Modified Content');
    expect(after?.strippedContent).not.toContain('Original Content');
  });

  it('re-reads after clearRuleCache without losing content', async () => {
    const { globalRulesDir } = setupTestDirs();
    const rulePath = path.join(globalRulesDir, 'cleared.md');
    writeFileSync(rulePath, '# Test Content');

    await getCachedRule(rulePath);
    clearRuleCache();
    const after = await getCachedRule(rulePath);

    expect(after?.strippedContent).toContain('Test Content');
  });
});

describe('discoverRuleFiles additional directories', () => {
  let envSnapshot: EnvSnapshot;
  let testDir: string;
  let projectDir: string;
  let globalRulesDir: string;

  beforeEach(() => {
    testDir = setupTestDirs().testDir;
    projectDir = path.join(testDir, 'project');
    globalRulesDir = path.join(testDir, '.config', 'opencode', 'rules');
    envSnapshot = saveEnv('XDG_CONFIG_HOME', 'HOME', 'OPENCODE_CONFIG_DIR');
    process.env.XDG_CONFIG_HOME = path.join(testDir, '.config');
  });

  afterEach(() => {
    teardownTestDirs();
    restoreEnv(envSnapshot);
    vi.resetAllMocks();
  });

  function extraDir(name: string): string {
    const dir = path.join(testDir, 'extra', name);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  it('scans built-in locations first, then additional directories in order', async () => {
    writeFileSync(path.join(globalRulesDir, 'global.md'), '# Global');
    mkdirSync(path.join(projectDir, '.opencode', 'rules'), { recursive: true });
    writeFileSync(
      path.join(projectDir, '.opencode', 'rules', 'local.md'),
      '# Local'
    );
    const first = extraDir('first');
    const second = extraDir('second');
    writeFileSync(path.join(first, 'one.md'), '# One');
    writeFileSync(path.join(second, 'two.mdc'), '# Two');

    const files = await discoverRuleFiles(projectDir, [first, second]);

    expect(files.map(file => file.relativePath)).toEqual([
      'global.md',
      'local.md',
      'one.md',
      'two.mdc',
    ]);
  });

  it('reports paths relative to the root of the directory they came from', async () => {
    const dir = extraDir('nested');
    mkdirSync(path.join(dir, 'lang', 'typescript'), { recursive: true });
    const rulePath = path.join(dir, 'lang', 'typescript', 'strict.md');
    writeFileSync(rulePath, '# Strict');

    const files = await discoverRuleFiles(projectDir, [dir]);

    expect(files).toEqual([
      {
        filePath: rulePath,
        relativePath: path.join('lang', 'typescript', 'strict.md'),
      },
    ]);
  });

  it('keeps absolute file paths as delivery identity', async () => {
    const dir = extraDir('identity');
    const rulePath = path.join(dir, 'id.md');
    writeFileSync(rulePath, '# Identity');

    const files = await discoverRuleFiles(projectDir, [dir]);

    expect(path.isAbsolute(files[0]!.filePath)).toBe(true);
  });

  it('loads a file reachable through more than one directory once', async () => {
    const dir = extraDir('shared');
    const rulePath = path.join(dir, 'shared.md');
    writeFileSync(rulePath, '# Shared');
    const nested = path.join(dir, 'sub');
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, 'nested.md'), '# Nested');
    writeFileSync(path.join(globalRulesDir, 'global.md'), '# Global');

    const files = await discoverRuleFiles(projectDir, [dir, nested]);

    expect(files.map(file => file.filePath)).toEqual([
      path.join(globalRulesDir, 'global.md'),
      rulePath,
      path.join(nested, 'nested.md'),
    ]);
  });

  it('scans additional directories recursively with the built-in file rules', async () => {
    const dir = extraDir('mixed');
    writeFileSync(path.join(dir, 'root.md'), '# Root');
    writeFileSync(path.join(dir, 'meta.mdc'), '# Meta');
    writeFileSync(path.join(dir, 'ignored.txt'), 'not a rule');
    writeFileSync(path.join(dir, '.hidden.md'), '# Hidden');
    mkdirSync(path.join(dir, '.git'), { recursive: true });
    writeFileSync(path.join(dir, '.git', 'config.md'), '# Config');
    mkdirSync(path.join(dir, 'deep'), { recursive: true });
    writeFileSync(path.join(dir, 'deep', 'child.md'), '# Child');

    const files = await discoverRuleFiles(projectDir, [dir]);

    // readdir order within one directory is not guaranteed, so only the set
    // of accepted files is asserted here.
    expect(files.map(file => file.relativePath).sort()).toEqual(
      ['meta.mdc', 'root.md', path.join('deep', 'child.md')].sort()
    );
  });

  it('ignores a missing additional directory without warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const files = await discoverRuleFiles(projectDir, [
      path.join(testDir, 'does-not-exist'),
    ]);

    expect(files).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps built-in discovery untouched when no directories are configured', async () => {
    writeFileSync(path.join(globalRulesDir, 'global.md'), '# Global');

    const files = await discoverRuleFiles(projectDir, []);

    expect(files.map(file => file.relativePath)).toEqual(['global.md']);
  });

  it('does not scan project rules when there is no project directory', async () => {
    const dir = extraDir('no-project');
    writeFileSync(path.join(dir, 'extra.md'), '# Extra');

    const files = await discoverRuleFiles(undefined, [dir]);

    expect(files.map(file => file.relativePath)).toEqual(['extra.md']);
  });
});
