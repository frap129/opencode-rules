import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { loadRuleSnapshots } from './rule-discovery.js';
import { setupTestDirs, teardownTestDirs } from './test-fixtures.js';

describe('loadRuleSnapshots', () => {
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
    teardownTestDirs();
  });
});
