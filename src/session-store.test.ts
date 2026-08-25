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

  it('defaults injected-rule tracking fields on new sessions', () => {
    const store = new SessionStore();
    store.upsert('ses_new', () => {});
    const state = store.get('ses_new');
    expect(state?.injectedRuleKeys).toBeInstanceOf(Set);
    expect(state?.injectedRuleKeys.size).toBe(0);
    expect(state?.injectedHookHashes.size).toBe(0);
    expect(state?.needsRuleRescan).toBe(false);
  });

  it('snapshots injected-rule key sets without aliasing the live sets', () => {
    const store = new SessionStore();
    store.upsert('ses_snap', s => {
      s.injectedRuleKeys.add('rule.md:abc');
      s.injectedHookHashes.add('def');
      s.needsRuleRescan = true;
    });
    const snapshot = store.snapshot('ses_snap');
    snapshot?.injectedRuleKeys.add('rule.md:xyz');
    expect(store.get('ses_snap')?.injectedRuleKeys.has('rule.md:xyz')).toBe(
      false
    );
    snapshot?.injectedHookHashes.add('xyz');
    expect(store.get('ses_snap')?.injectedHookHashes.has('xyz')).toBe(false);
    expect(snapshot?.needsRuleRescan).toBe(true);
  });
});

describe('pending hook injections', () => {
  it('stores and retrieves pending hook injections', () => {
    const store = new SessionStore();
    store.upsert('ses_hooks', state => {
      state.pendingHookInjections = ['Injection A', 'Injection B'];
    });
    const snapshot = store.snapshot('ses_hooks');
    expect(snapshot?.pendingHookInjections).toEqual([
      'Injection A',
      'Injection B',
    ]);
  });
});
