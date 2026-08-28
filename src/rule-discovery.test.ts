import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import path from 'node:path';
import { writeFileSync, utimesSync } from 'node:fs';
import {
  loadRuleSnapshots,
  getCachedRule,
  clearRuleCache,
} from './rule-discovery.js';
import { setupTestDirs, teardownTestDirs } from './test-fixtures.js';

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
