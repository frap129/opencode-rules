import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  discoverRuleFiles,
  discoverProjectRuleFiles,
} from './rule-discovery.js';
import {
  setupTestDirs,
  teardownTestDirs,
  getTestDirs,
  saveEnv,
  restoreEnv,
  type EnvSnapshot,
} from './test-fixtures.js';

describe('discoverRuleFiles', () => {
  let envSnapshot: EnvSnapshot;

  beforeEach(() => {
    setupTestDirs();
    envSnapshot = saveEnv('XDG_CONFIG_HOME', 'OPENCODE_CONFIG_DIR');
    process.env.XDG_CONFIG_HOME = path.join(getTestDirs().testDir, '.config');
    delete process.env.OPENCODE_CONFIG_DIR;
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
    teardownTestDirs();
  });

  it('discovers global and project rules together', async () => {
    const { globalRulesDir, projectRulesDir, testDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'global.md'), '# Global');
    writeFileSync(path.join(projectRulesDir, 'project.md'), '# Project');
    const files = await discoverRuleFiles(path.join(testDir, 'project'));
    expect(files.map(f => f.relativePath).sort()).toEqual([
      'global.md',
      'project.md',
    ]);
  });
});

describe('discoverProjectRuleFiles', () => {
  let envSnapshot: EnvSnapshot;

  beforeEach(() => {
    setupTestDirs();
    envSnapshot = saveEnv('XDG_CONFIG_HOME', 'OPENCODE_CONFIG_DIR');
    process.env.XDG_CONFIG_HOME = path.join(getTestDirs().testDir, '.config');
    delete process.env.OPENCODE_CONFIG_DIR;
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
    teardownTestDirs();
  });

  it('discovers only project rules, never global rules', async () => {
    const { testDir, globalRulesDir, projectRulesDir } = getTestDirs();
    writeFileSync(path.join(globalRulesDir, 'global.md'), '# Global');
    writeFileSync(path.join(projectRulesDir, 'project.md'), '# Project');
    const files = await discoverProjectRuleFiles(path.join(testDir, 'project'));
    expect(files.map(f => f.relativePath)).toEqual(['project.md']);
  });

  it('returns empty array when project rules dir is missing', async () => {
    const { testDir } = getTestDirs();
    const files = await discoverProjectRuleFiles(path.join(testDir, 'nope'));
    expect(files).toEqual([]);
  });

  it('discovers nested project rules with relative paths', async () => {
    const { testDir, projectRulesDir } = getTestDirs();
    mkdirSync(path.join(projectRulesDir, 'sub'), { recursive: true });
    writeFileSync(path.join(projectRulesDir, 'sub', 'deep.md'), '# Deep');
    const files = await discoverProjectRuleFiles(path.join(testDir, 'project'));
    expect(files.map(f => f.relativePath)).toEqual([
      path.join('sub', 'deep.md'),
    ]);
  });
});
