import { describe, it, expect, vi } from 'vitest';
import { createSessionWorkingContext } from './session-working-context.js';
import { SessionStore } from './session-store.js';
import type { RawHistoryResult } from './rule-delivery-history.js';
import type { MessageWithInfo } from './message-context.js';

type Upstream = (sessionID: string) => Promise<RawHistoryResult>;
const storesByContext = new WeakMap<object, SessionStore>();

function setUpstream(
  result: RawHistoryResult | (() => Promise<RawHistoryResult>)
): { upstream: Upstream; calls: () => number } {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (typeof result === 'function') return result();
    // The client returns the full recorded history on every read.
    return result;
  };
  return { upstream: fn, calls: () => calls };
}

function historyMessage(
  sessionID: string,
  parts: Array<Record<string, unknown>>
): MessageWithInfo {
  return { info: { role: 'user', sessionID }, parts: parts as never[] };
}

interface SetupOptions {
  history?: RawHistoryResult | (() => Promise<RawHistoryResult>);
}

function setup(opts: SetupOptions = {}) {
  const sessionStore = new SessionStore();
  const { upstream, calls } = setUpstream(
    opts.history ?? { ok: true, messages: [] }
  );
  const debugLog = vi.fn();
  const swc = createSessionWorkingContext({
    sessionStore,
    projectDirectory: '/proj',
    readHistory: upstream,
    debugLog,
  });
  storesByContext.set(swc.workingContext, sessionStore);
  return {
    swc,
    sessionStore,
    debugLog,
    calls,
    wc: swc.workingContext,
  };
}

function supplied(
  parts: Array<Record<string, unknown>>,
  sessionID = 'ses_1'
): MessageWithInfo[] {
  return [
    {
      info: { role: 'user', sessionID },
      parts: parts as never[],
    },
  ];
}

const readInvocation = (filePath: string): Record<string, unknown> => ({
  type: 'tool-invocation',
  toolInvocation: { toolName: 'read', args: { filePath } },
});

const observedPaths = (
  wc: ReturnType<typeof createSessionWorkingContext>['workingContext'],
  sessionID: string
): string[] =>
  Array.from(
    storesByContext.get(wc)?.snapshot(sessionID)?.workingContextPaths ?? []
  ).sort((a, b) => a.localeCompare(b));

describe('SessionWorkingContext facets', () => {
  it('returns separate working-context and raw-history facets', () => {
    const { swc } = setup();
    expect(Object.keys(swc).sort()).toEqual(['rawHistory', 'workingContext']);
    expect(Object.keys(swc.workingContext).sort()).toEqual([
      'invalidateHistoryReads',
      'prepareDurableTurn',
      'prepareForCompaction',
      'recordMessageParts',
      'recordObservations',
      'seedFromSuppliedMessages',
    ]);
    expect(Object.keys(swc.rawHistory).sort()).toEqual(['readHistory']);
  });
});

describe('supplied-message seeding', () => {
  it('seeds paths from supplied transform messages', async () => {
    const { wc } = setup();
    await wc.seedFromSuppliedMessages(
      'ses_1',
      supplied([readInvocation('src/a.ts')])
    );
    expect(observedPaths(wc, 'ses_1')).toEqual(['src/a.ts']);
  });

  it('marks seeding complete on a successful empty message set', async () => {
    const { wc, calls } = setup({
      history: {
        ok: true,
        messages: [historyMessage('ses_1', [readInvocation('src/h.ts')])],
      },
    });
    await wc.seedFromSuppliedMessages('ses_1', supplied([]));
    await wc.prepareDurableTurn('ses_1');
    expect(calls()).toBe(0);
    expect(observedPaths(wc, 'ses_1')).toEqual([]);
  });

  it('reports whether it performed the seeding', async () => {
    const { wc } = setup();
    expect(await wc.seedFromSuppliedMessages('ses_seed', supplied([]))).toBe(
      true
    );
    expect(await wc.seedFromSuppliedMessages('ses_seed', supplied([]))).toBe(
      false
    );
  });

  it('normalizes and deduplicates paths across seeds', async () => {
    const { wc } = setup();
    await wc.seedFromSuppliedMessages(
      'ses_1',
      supplied([readInvocation('/proj/src/a.ts')])
    );
    await wc.seedFromSuppliedMessages(
      'ses_1',
      supplied([readInvocation('src/a.ts')])
    );
    expect(observedPaths(wc, 'ses_1')).toEqual(['src/a.ts']);
  });

  it('exposes detached sorted paths; mutating the view does not alter storage', async () => {
    const { wc } = setup();
    await wc.seedFromSuppliedMessages(
      'ses_1',
      supplied([readInvocation('src/zebra.ts'), readInvocation('src/alpha.ts')])
    );
    const paths = observedPaths(wc, 'ses_1');
    expect(paths).toEqual(['src/alpha.ts', 'src/zebra.ts']);
    paths.reverse();
    paths.push('src/injected.ts');
    expect(observedPaths(wc, 'ses_1')).toEqual([
      'src/alpha.ts',
      'src/zebra.ts',
    ]);
  });
});

describe('live accumulation', () => {
  it('accumulates tool-call observations monotonically', () => {
    const { wc } = setup();
    wc.recordObservations('ses_1', [
      { path: 'src/a.ts', tool: 'read', content: '' },
    ]);
    expect(observedPaths(wc, 'ses_1')).toEqual(['src/a.ts']);
  });

  it('stores only paths from live observations', () => {
    const { wc } = setup();
    wc.recordObservations('ses_1', [
      { path: 'src/lib.rs', tool: 'write', content: 'unsafe { }' },
    ]);
    expect(observedPaths(wc, 'ses_1')).toEqual(['src/lib.rs']);
  });

  it('records paths from the current message parts', () => {
    const { wc } = setup();
    wc.recordMessageParts('ses_1', [
      {
        type: 'tool-invocation',
        toolInvocation: { toolName: 'read', args: { filePath: 'src/x.ts' } },
      },
    ]);
    wc.recordMessageParts('ses_1', [
      {
        type: 'tool',
        tool: 'edit',
        state: {
          status: 'completed',
          input: {
            filePath: 'src/attached.yml',
            oldString: 'a',
            newString: 'b',
          },
        },
      },
    ]);
    expect(observedPaths(wc, 'ses_1')).toEqual([
      'src/attached.yml',
      'src/x.ts',
    ]);
  });

  it('excludes synthetic parts from seeding', async () => {
    const { wc } = setup();
    await wc.seedFromSuppliedMessages(
      'ses_1',
      supplied([{ type: 'text', text: 'src/synthetic.ts', synthetic: true }])
    );
    expect(observedPaths(wc, 'ses_1')).toEqual([]);
  });

  it('tolerates malformed supplied messages', async () => {
    const { wc } = setup();
    await wc.seedFromSuppliedMessages('ses_1', [
      { info: undefined } as unknown as MessageWithInfo,
      { info: { role: 'user', sessionID: 'ses_1' } },
      null as unknown as MessageWithInfo,
      {
        info: { role: 'user', sessionID: 'ses_1' },
        parts: [
          {},
          {
            type: 'tool-invocation',
            toolInvocation: {
              toolName: 'write',
              args: { filePath: 'src/fine.ts', content: 'x' },
            },
          },
        ] as never[],
      },
    ]);
    expect(observedPaths(wc, 'ses_1')).toEqual(['src/fine.ts']);
  });
});

describe('durable-turn preparation', () => {
  it('does not reseed after supplied-message seeding', async () => {
    const { wc, calls } = setup({
      history: {
        ok: true,
        messages: [historyMessage('ses_1', [readInvocation('src/h.ts')])],
      },
    });
    await wc.seedFromSuppliedMessages(
      'ses_1',
      supplied([readInvocation('src/live.ts')])
    );
    await wc.prepareDurableTurn('ses_1');
    await wc.prepareDurableTurn('ses_1');
    expect(calls()).toBe(0);
    expect(observedPaths(wc, 'ses_1')).toEqual(['src/live.ts']);
  });

  it('fails open on rejected history and allows a later retry', async () => {
    const { wc } = setup({
      history: () => Promise.reject(new Error('down')),
    });
    wc.recordObservations('ses_1', [
      { path: 'src/live.ts', tool: 'read', content: '' },
    ]);
    await wc.prepareDurableTurn('ses_1');
    expect(observedPaths(wc, 'ses_1')).toEqual(['src/live.ts']);
    await wc.prepareDurableTurn('ses_1');
    expect(observedPaths(wc, 'ses_1')).toEqual(['src/live.ts']);
  });
});

describe('prefetch for RuleDelivery', () => {
  it('retains a one-use prefetch after seeding from history', async () => {
    const { swc, wc, calls } = setup({
      history: {
        ok: true,
        messages: [historyMessage('ses_1', [readInvocation('src/h.ts')])],
      },
    });
    await wc.prepareDurableTurn('ses_1');
    expect(observedPaths(wc, 'ses_1')).toEqual(['src/h.ts']);
    expect(await swc.rawHistory.readHistory('ses_1')).toEqual({
      ok: true,
      messages: [historyMessage('ses_1', [readInvocation('src/h.ts')])],
    });
    expect(calls()).toBe(1);
    // One-use: the second read delegates upstream.
    expect(await swc.rawHistory.readHistory('ses_1')).toEqual({
      ok: true,
      messages: [historyMessage('ses_1', [readInvocation('src/h.ts')])],
    });
    expect(calls()).toBe(2);
  });

  it('retains failed reads as one-use results for RuleDelivery', async () => {
    let calls = 0;
    const swc = createSessionWorkingContext({
      sessionStore: new SessionStore(),
      projectDirectory: '/proj',
      readHistory: async () => {
        calls++;
        return { ok: false };
      },
      debugLog: () => {},
    });
    await swc.workingContext.prepareDurableTurn('ses_1');
    expect(observedPaths(swc.workingContext, 'ses_1')).toEqual([]);
    // First raw read consumes the one-use failed prefetch; second goes upstream.
    expect(await swc.rawHistory.readHistory('ses_1')).toEqual({ ok: false });
    expect(await swc.rawHistory.readHistory('ses_1')).toEqual({ ok: false });
    expect(calls).toBe(2);
  });

  it('delegates without seeding when RuleDelivery reads raw history first', async () => {
    const { swc, wc, calls } = setup({
      history: {
        ok: true,
        messages: [historyMessage('ses_1', [readInvocation('src/h.ts')])],
      },
    });
    expect(await swc.rawHistory.readHistory('ses_1')).toEqual({
      ok: true,
      messages: [historyMessage('ses_1', [readInvocation('src/h.ts')])],
    });
    expect(calls()).toBe(1);
    expect(observedPaths(wc, 'ses_1')).toEqual([]);
    await wc.prepareDurableTurn('ses_1');
    expect(observedPaths(wc, 'ses_1')).toEqual(['src/h.ts']);
    expect(calls()).toBe(2);
  });
});

describe('history invalidation', () => {
  it('monotonic paths survive invalidation', async () => {
    const { wc, calls } = setup({
      history: {
        ok: true,
        messages: [historyMessage('ses_1', [readInvocation('src/h.ts')])],
      },
    });
    wc.recordObservations('ses_1', [
      { path: 'src/live.ts', tool: 'read', content: '' },
    ]);
    await wc.prepareDurableTurn('ses_1');
    wc.invalidateHistoryReads('ses_1');
    expect(observedPaths(wc, 'ses_1')).toEqual(
      expect.arrayContaining(['src/h.ts', 'src/live.ts'])
    );
    expect(calls()).toBe(1);
  });

  it('a read invalidated after settling does not seed or refill prefetch', async () => {
    let releaseHistory: ((r: RawHistoryResult) => void) | undefined;
    const history = new Promise<RawHistoryResult>(resolve => {
      releaseHistory = resolve;
    });
    let upstreamCalls = 0;
    const swc = createSessionWorkingContext({
      sessionStore: new SessionStore(),
      projectDirectory: '/proj',
      readHistory: () => {
        upstreamCalls++;
        return history;
      },
      debugLog: () => {},
    });
    const pending = swc.workingContext.prepareDurableTurn('ses_1');
    swc.workingContext.invalidateHistoryReads('ses_1');
    releaseHistory!({
      ok: true,
      messages: [historyMessage('ses_1', [readInvocation('src/h.ts')])],
    });
    await pending;
    expect(observedPaths(swc.workingContext, 'ses_1')).toEqual([]);
    // No prefetch refilled: the RuleDelivery read goes upstream.
    expect(await swc.rawHistory.readHistory('ses_1')).toEqual({
      ok: true,
      messages: [historyMessage('ses_1', [readInvocation('src/h.ts')])],
    });
    expect(upstreamCalls).toBe(2);
  });
});

describe('prefetch retention bounds', () => {
  it('retains at most eight completed, unconsumed prefetches, evicting oldest first', async () => {
    const { swc, wc, calls } = setup({
      history: { ok: true, messages: [] },
    });
    // Prepare ten sessions: each read completes and is retained as a
    // prefetch until the bound evicts the oldest.
    for (let i = 0; i < 10; i++) {
      await wc.prepareDurableTurn(`ses_bound_${i}`);
    }
    expect(calls()).toBe(10);

    // Consuming reads: sessions 0 and 1 were evicted (oldest first), so
    // their raw reads go upstream; sessions 2..9 still hit the prefetch.
    await swc.rawHistory.readHistory('ses_bound_0');
    await swc.rawHistory.readHistory('ses_bound_1');
    for (let i = 2; i < 10; i++) {
      await swc.rawHistory.readHistory(`ses_bound_${i}`);
    }
    expect(calls()).toBe(12);
  });

  it('evicting a prefetch does not alter Working context', async () => {
    const { swc } = setup({
      history: {
        ok: true,
        messages: [historyMessage('ses_evicted', [readInvocation('src/h.ts')])],
      },
    });
    for (let i = 0; i < 8; i++) {
      const store = i === 0 ? 'ses_evicted' : `ses_other_${i}`;
      await swc.workingContext.prepareDurableTurn(store);
    }
    // ses_evicted was seeded before its prefetch got evicted... prepare
    // forces one read per unseeded session; other sessions push it out.
    // Its own Working context is untouched by the eviction.
    const remembered = observedPaths(swc.workingContext, 'ses_evicted');
    for (let i = 8; i < 10; i++) {
      await swc.workingContext.prepareDurableTurn(`ses_other_${i}`);
    }
    expect(observedPaths(swc.workingContext, 'ses_evicted')).toEqual(
      remembered
    );
  });
});

describe('concurrent preparation', () => {
  it('shares one in-flight read per session', async () => {
    const { wc, calls } = setup({
      history: {
        ok: true,
        messages: [historyMessage('ses_1', [readInvocation('src/h.ts')])],
      },
    });
    await Promise.all([
      wc.prepareDurableTurn('ses_1'),
      wc.prepareDurableTurn('ses_1'),
    ]);
    expect(calls()).toBe(1);
    expect(observedPaths(wc, 'ses_1')).toEqual(['src/h.ts']);
  });

  it('keeps different sessions independent', async () => {
    const { wc, calls } = setup({
      history: {
        ok: true,
        messages: [historyMessage('multi', [readInvocation('src/h.ts')])],
      },
    });
    await Promise.all([
      wc.prepareDurableTurn('ses_a'),
      wc.prepareDurableTurn('ses_b'),
    ]);
    expect(calls()).toBe(2);
  });
});

describe('compaction preparation', () => {
  it('returns the projection, limit, and omission count', () => {
    const { wc } = setup();
    for (let i = 1; i <= 25; i++) {
      const path = `path/to/file${i.toString().padStart(2, '0')}.ts`;
      wc.recordObservations('ses_c', [{ path, tool: 'read', content: '' }]);
    }
    const projection = wc.prepareForCompaction('ses_c');
    expect(projection).toContain('OpenCode Rules: Working context');
    expect(projection).not.toContain('file25.ts');
    expect(projection).toContain('... and 5 more paths');
  });

  it('produces no projection for empty working context', () => {
    const { wc } = setup();
    expect(wc.prepareForCompaction('ses_none')).toBeUndefined();
  });

  it('invalidates history reads without subtracting paths', async () => {
    const { swc, wc, calls } = setup({
      history: {
        ok: true,
        messages: [historyMessage('ses_ci', [readInvocation('src/h.ts')])],
      },
    });
    await wc.prepareDurableTurn('ses_ci');
    const projection = wc.prepareForCompaction('ses_ci');
    expect(projection).toContain('src/h.ts');
    // Compaction invalidated the prefetch: the next raw read goes upstream.
    await swc.rawHistory.readHistory('ses_ci');
    expect(calls()).toBe(2);
  });
});
