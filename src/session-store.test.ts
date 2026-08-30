import { describe, it, expect } from 'vitest';
import { SessionStore } from './session-store.js';

describe('SessionStore', () => {
  it('prunes oldest sessions when over max', () => {
    const store = new SessionStore({ max: 2 });

    store.upsert('ses_1', () => {});
    store.upsert('ses_2', () => {});
    store.upsert('ses_3', () => {});

    const ids = store.ids();
    expect(ids).toHaveLength(2);
    expect(ids).toContain('ses_2');
    expect(ids).toContain('ses_3');
  });

  it('drains to empty when max is set to 0', () => {
    // Ticket #64 decision: setMax keeps the raw limit, so a limit of 0
    // drains the store to empty on the next upsert.
    const store = new SessionStore();
    store.upsert('ses_a', () => {});
    store.upsert('ses_b', () => {});

    store.setMax(0);
    store.upsert('ses_c', () => {});

    expect(store.ids()).toHaveLength(0);
  });

  it('snapshots working-context paths without aliasing the live set', () => {
    const store = new SessionStore();
    store.upsert('ses_snap', s => {
      s.workingContextPaths.add('src/example.ts');
    });
    const snapshot = store.snapshot('ses_snap');
    snapshot?.workingContextPaths.add('src/other.ts');
    expect(store.get('ses_snap')?.workingContextPaths.has('src/other.ts')).toBe(
      false
    );
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
