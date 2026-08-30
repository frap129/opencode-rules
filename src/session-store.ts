import type { RuleSnapshot } from './rule-discovery.js';
import { BoundedSessionMap } from './bounded-session-map.js';
export interface SessionState {
  /** Working context: monotonic set of observed file paths. Only
   * SessionWorkingContext production code reads or mutates these fields. */
  workingContextPaths: Set<string>;
  lastUserPrompt?: string;
  lastUpdated: number;
  /** True when the first successful seeding source has completed. */
  workingContextSeeded: boolean;
  lastModelID?: string;
  lastAgentType?: string;
  ruleSnapshots?: RuleSnapshot[];
}

interface SessionStoreOptions {
  max?: number;
}

export class SessionStore {
  private stateMap = new Map<string, SessionState>();
  private max: number;
  private tick = 0;
  /** Recency + eviction oracle; stateMap holds the values. */
  private recency: BoundedSessionMap<void>;

  constructor(opts: SessionStoreOptions = {}) {
    this.max = opts.max ?? 100;
    this.recency = new BoundedSessionMap<void>({ max: Math.max(1, this.max) });
  }

  setMax(limit: number): void {
    // Explicit ticket #64 decision: keep the facade unclamped. A limit of 0
    // drains the store to empty on the next upsert, unlike the shared
    // BoundedSessionMap which clamps its bound to >= 1.
    this.max = limit;
    this.recency.setMax(Math.max(1, limit));
  }

  ids(): string[] {
    return Array.from(this.stateMap.keys());
  }

  get(sessionID: string): SessionState | undefined {
    return this.stateMap.get(sessionID);
  }

  snapshot(sessionID: string): SessionState | undefined {
    const s = this.stateMap.get(sessionID);
    if (!s) return undefined;
    const snapshot: SessionState = {
      ...s,
      workingContextPaths: new Set(s.workingContextPaths),
    };
    if (s.ruleSnapshots) {
      snapshot.ruleSnapshots = s.ruleSnapshots.map(rule => ({ ...rule }));
    }
    return snapshot;
  }

  reset(): void {
    this.stateMap.clear();
    this.max = 100;
    this.tick = 0;
    this.recency.reset();
  }

  upsert(sessionID: string, mutator: (state: SessionState) => void): void {
    let state = this.stateMap.get(sessionID);
    if (!state) {
      state = this.createDefaultState();
      this.stateMap.set(sessionID, state);
    }

    mutator(state);

    // Match existing semantics: overwrite lastUpdated after mutation.
    state.lastUpdated = ++this.tick;

    this.recency.ensure(sessionID, () => undefined);
    this.purgeEvicted();
  }

  private purgeEvicted(): void {
    const live = new Set(this.recency.ids());
    for (const id of this.stateMap.keys()) {
      if (!live.has(id)) this.stateMap.delete(id);
    }
    // Explicit ticket #64 decision: the facade stays unclamped, so a raw
    // limit <= 0 drains the store entirely on each upsert.
    if (this.max <= 0) this.stateMap.clear();
  }

  private createDefaultState(): SessionState {
    // Match existing semantics: tick increments on creation, then again on upsert.
    return {
      workingContextPaths: new Set<string>(),
      lastUpdated: ++this.tick,
      workingContextSeeded: false,
    };
  }
}
