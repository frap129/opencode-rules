import type { RuleSnapshot } from './rule-discovery.js';

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

  constructor(opts: SessionStoreOptions = {}) {
    this.max = opts.max ?? 100;
  }

  setMax(limit: number): void {
    this.max = limit;
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

    while (this.stateMap.size > this.max) {
      let oldestID: string | null = null;
      let oldestTime = Infinity;

      for (const [id, st] of this.stateMap.entries()) {
        if (st.lastUpdated < oldestTime) {
          oldestTime = st.lastUpdated;
          oldestID = id;
        }
      }

      if (oldestID) {
        this.stateMap.delete(oldestID);
      }
    }
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
