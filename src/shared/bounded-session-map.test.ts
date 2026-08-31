import { describe, it, expect, vi } from 'vitest';
import { BoundedSessionMap } from './bounded-session-map.js';

describe('BoundedSessionMap ensure', () => {
  it('returns the existing entry without recreating it', () => {
    const map = new BoundedSessionMap<{ value: number }>();
    const first = map.ensure('ses_1', () => ({ value: 1 }));
    first.value = 2;
    const second = map.ensure('ses_1', () => ({ value: 99 }));
    expect(second).toBe(first);
    expect(second.value).toBe(2);
  });

  it('creates a missing entry via the create callback', () => {
    const map = new BoundedSessionMap<{ id: string }>();
    const entry = map.ensure('ses_1', () => ({ id: 'created' }));
    expect(entry.id).toBe('created');
  });

  it('auto-evicts the least-recently-stamped entry at the bound', () => {
    const map = new BoundedSessionMap<{ n: number }>({ max: 2 });
    map.ensure('ses_1', () => ({ n: 1 }));
    map.ensure('ses_2', () => ({ n: 2 }));
    map.ensure('ses_3', () => ({ n: 3 }));
    expect(map.ids()).toEqual(['ses_2', 'ses_3']);
  });

  it('calls create only once per session', () => {
    const create = vi.fn(() => ({ n: 0 }));
    const map = new BoundedSessionMap<ReturnType<typeof create>>({ max: 2 });
    map.ensure('ses_1', create);
    map.ensure('ses_1', create);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('BoundedSessionMap recency', () => {
  it('evicts by recency stamps, not insertion order', () => {
    const map = new BoundedSessionMap<{ n: number }>({ max: 2 });
    map.ensure('ses_1', () => ({ n: 1 }));
    map.ensure('ses_2', () => ({ n: 2 }));
    // Re-stamp ses_1 so ses_2 becomes least-recently-stamped.
    map.touch('ses_1');
    map.ensure('ses_3', () => ({ n: 3 }));
    expect(map.ids()).toEqual(['ses_1', 'ses_3']);
  });

  it('touch re-stamps a present entry without creating it', () => {
    const map = new BoundedSessionMap<{ n: number }>({ max: 2 });
    map.ensure('ses_1', () => ({ n: 1 }));
    map.ensure('ses_2', () => ({ n: 2 }));
    map.touch('ses_1');
    map.ensure('ses_3', () => ({ n: 3 }));
    expect(map.ids()).toEqual(['ses_1', 'ses_3']);
  });

  it('touch is a no-op for a missing entry', () => {
    const map = new BoundedSessionMap<{ n: number }>();
    map.touch('ses_missing');
    expect(map.ids()).toEqual([]);
  });

  it('evict() runs the scan alone without stamping', () => {
    const map = new BoundedSessionMap<{ n: number }>({ max: 2 });
    map.ensure('ses_1', () => ({ n: 1 }));
    map.ensure('ses_2', () => ({ n: 2 }));
    // setMax shrinks the bound; evict() applies it without any stamping.
    map.setMax(1);
    map.evict();
    expect(map.ids()).toEqual(['ses_2']);
  });
});

describe('BoundedSessionMap reads', () => {
  it('get returns the stored value without stamping it', () => {
    const map = new BoundedSessionMap<{ n: number }>({ max: 2 });
    map.ensure('ses_1', () => ({ n: 1 }));
    map.ensure('ses_2', () => ({ n: 2 }));
    // An unstamped get leaves ses_1 least-recent, so ses_3 evicts it.
    expect(map.get('ses_1')?.n).toBe(1);
    map.ensure('ses_3', () => ({ n: 3 }));
    expect(map.ids()).toEqual(['ses_2', 'ses_3']);
  });

  it('get returns undefined for a missing entry', () => {
    const map = new BoundedSessionMap<{ n: number }>();
    expect(map.get('ses_missing')).toBeUndefined();
  });

  it('touch returns the stamped value', () => {
    const map = new BoundedSessionMap<{ n: number }>({ max: 2 });
    map.ensure('ses_1', () => ({ n: 1 }));
    map.ensure('ses_2', () => ({ n: 2 }));
    expect(map.touch('ses_1')?.n).toBe(1);
    map.ensure('ses_3', () => ({ n: 3 }));
    expect(map.ids()).toEqual(['ses_1', 'ses_3']);
  });

  it('touch returns undefined for a missing entry', () => {
    const map = new BoundedSessionMap<{ n: number }>();
    expect(map.touch('ses_missing')).toBeUndefined();
    expect(map.ids()).toEqual([]);
  });
});

describe('BoundedSessionMap protection', () => {
  it('never evicts an entry the isEvictable predicate protects', () => {
    const map = new BoundedSessionMap<{ n: number }>({
      max: 2,
      isEvictable: sessionID => sessionID !== 'ses_protected',
    });
    map.ensure('ses_protected', () => ({ n: 1 }));
    map.ensure('ses_free', () => ({ n: 2 }));
    map.ensure('ses_new', () => ({ n: 3 }));
    expect(map.ids()).toEqual(['ses_protected', 'ses_new']);
  });

  it('stops without deleting when every entry is protected', () => {
    const map = new BoundedSessionMap<{ n: number }>({
      max: 1,
      isEvictable: () => false,
    });
    map.ensure('ses_a', () => ({ n: 1 }));
    map.ensure('ses_b', () => ({ n: 2 }));
    expect(map.ids()).toEqual(['ses_a', 'ses_b']);
  });

  it('can evict a previously protected entry once it becomes evictable', () => {
    let isProtected = true;
    const map = new BoundedSessionMap<{ n: number }>({
      max: 1,
      isEvictable: () => !isProtected,
    });
    map.ensure('ses_a', () => ({ n: 1 }));
    map.ensure('ses_b', () => ({ n: 2 }));
    expect(map.ids()).toEqual(['ses_a', 'ses_b']);
    isProtected = false;
    map.evict();
    expect(map.ids()).toEqual(['ses_b']);
  });
});

describe('BoundedSessionMap bound configuration', () => {
  it('drains to empty when the bound is 0', () => {
    // SessionStore needs an unclamped bound so setMax(0) can drain the
    // store; callers that must never drain to empty pass minBound: 1.
    const map = new BoundedSessionMap<{ n: number }>({ max: 0 });
    map.ensure('ses_1', () => ({ n: 1 }));
    map.ensure('ses_2', () => ({ n: 2 }));
    expect(map.ids()).toEqual([]);
  });

  it('clamps the bound to minBound', () => {
    const map = new BoundedSessionMap<{ n: number }>({ minBound: 1, max: 0 });
    map.ensure('ses_1', () => ({ n: 1 }));
    map.ensure('ses_2', () => ({ n: 2 }));
    expect(map.ids()).toEqual(['ses_2']);
  });

  it('setMax respects minBound', () => {
    const map = new BoundedSessionMap<{ n: number }>({ minBound: 1, max: 3 });
    map.ensure('ses_1', () => ({ n: 1 }));
    map.setMax(0);
    map.ensure('ses_2', () => ({ n: 2 }));
    expect(map.ids()).toEqual(['ses_2']);
  });

  it('setMax drains to empty when set to 0', () => {
    const map = new BoundedSessionMap<{ n: number }>({ max: 2 });
    map.ensure('ses_1', () => ({ n: 1 }));
    map.setMax(0);
    map.ensure('ses_2', () => ({ n: 2 }));
    expect(map.ids()).toEqual([]);
  });

  it('setMax raises the bound without evicting present entries', () => {
    const map = new BoundedSessionMap<{ n: number }>({ max: 1 });
    map.ensure('ses_1', () => ({ n: 1 }));
    map.setMax(3);
    map.ensure('ses_2', () => ({ n: 2 }));
    map.ensure('ses_3', () => ({ n: 3 }));
    expect(map.ids()).toEqual(['ses_1', 'ses_2', 'ses_3']);
  });

  it('setMax below current size does not evict until the next ensure', () => {
    const map = new BoundedSessionMap<{ n: number }>({ max: 3 });
    map.ensure('ses_1', () => ({ n: 1 }));
    map.ensure('ses_2', () => ({ n: 2 }));
    map.ensure('ses_3', () => ({ n: 3 }));
    map.setMax(1);
    expect(map.ids()).toEqual(['ses_1', 'ses_2', 'ses_3']);
    map.ensure('ses_4', () => ({ n: 4 }));
    expect(map.ids()).toEqual(['ses_4']);
  });

  it('defaults the bound to 100', () => {
    const map = new BoundedSessionMap<{ n: number }>();
    for (let i = 0; i <= 100; i++) {
      map.ensure(`ses_${i}`, () => ({ n: i }));
    }
    expect(map.ids()).toHaveLength(100);
    expect(map.ids()[0]).toBe('ses_1');
    expect(map.ids()[99]).toBe('ses_100');
  });

  it('reset clears entries and restores the default bound', () => {
    const map = new BoundedSessionMap<{ n: number }>({ max: 2 });
    map.ensure('ses_1', () => ({ n: 1 }));
    map.setMax(1);
    map.reset();
    expect(map.ids()).toEqual([]);
    // Default bound (100) is restored: 101 ensures leave 100 entries.
    for (let i = 0; i <= 100; i++) {
      map.ensure(`ses_${i}`, () => ({ n: i }));
    }
    expect(map.ids()).toHaveLength(100);
  });
});

describe('BoundedSessionMap surface', () => {
  it('exposes exactly the agreed methods and no recency stamping API', () => {
    const methods = Object.getOwnPropertyNames(
      BoundedSessionMap.prototype
    ).filter(name => name !== 'constructor');
    expect([...methods].sort()).toEqual([
      'ensure',
      'evict',
      'get',
      'ids',
      'reset',
      'setMax',
      'touch',
    ]);
  });
});
