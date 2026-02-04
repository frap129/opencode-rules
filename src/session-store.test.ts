import { describe, it, expect } from 'vitest';

// Module does not exist yet; this test should fail first.
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

  it('skips injection while compacting, but resumes after TTL expiry', () => {
    const store = new SessionStore({ max: 100 });

    store.upsert('ses_c', s => {
      s.isCompacting = true;
      s.compactingSince = 1000;
    });

    // Not expired
    expect(store.shouldSkipInjection('ses_c', 1000 + 29_000, 30_000)).toBe(
      true
    );

    // Expired: should clear flag and allow injection
    expect(store.shouldSkipInjection('ses_c', 1000 + 31_000, 30_000)).toBe(
      false
    );
    expect(store.get('ses_c')?.isCompacting).toBe(false);
  });

  it('treats missing compactingSince as still compacting', () => {
    const store = new SessionStore({ max: 100 });
    store.upsert('ses_missing', s => void (s.isCompacting = true));

    expect(store.shouldSkipInjection('ses_missing', 1234, 30_000)).toBe(true);
  });
});
