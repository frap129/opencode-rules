import { describe, it, expect } from 'vitest';
import { SessionStore } from './session-store.js';

describe('SessionStore', () => {
  it('prunes oldest sessions when over max', () => {
    const store = new SessionStore({ max: 2 });

    store.upsert('ses_1', s => void (s.lastUpdated = 1));
    store.upsert('ses_2', s => void (s.lastUpdated = 2));
    store.upsert('ses_3', s => void (s.lastUpdated = 3));

    const ids = store.ids();
    expect(ids).toHaveLength(2);
    expect(ids).toContain('ses_2');
    expect(ids).toContain('ses_3');
  });

  it('snapshots context paths without aliasing the live set', () => {
    const store = new SessionStore();
    store.upsert('ses_snap', s => {
      s.contextPaths.add('src/example.ts');
    });
    const snapshot = store.snapshot('ses_snap');
    snapshot?.contextPaths.add('src/other.ts');
    expect(store.get('ses_snap')?.contextPaths.has('src/other.ts')).toBe(false);
  });
});

describe('SessionStore rule snapshots', () => {
  it('clones rule snapshots', () => {
    const store = new SessionStore();
    store.upsert('ses_clone', state => {
      state.ruleSnapshots = [
        {
          filePath: '/rules/plan.mdc',
          relativePath: 'plan.mdc',
          metadata: { agent: ['plan'] },
          strippedContent: 'Plan body.',
        },
      ];
    });

    const copied = store.snapshot('ses_clone');
    copied!.ruleSnapshots!.pop();

    expect(store.get('ses_clone')?.ruleSnapshots).toHaveLength(1);
  });
});
