export interface SessionState {
  contextPaths: Set<string>;
  lastUserPrompt?: string;
  lastUpdated: number;
  isCompacting?: boolean;
  compactingSince?: number;
  seededFromHistory: boolean;
  seedCount?: number;
}

export interface SessionStoreOptions {
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
    return {
      ...s,
      contextPaths: new Set(s.contextPaths),
    };
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

  markCompacting(sessionID: string, nowMs: number): void {
    this.upsert(sessionID, state => {
      state.isCompacting = true;
      state.compactingSince = nowMs;
    });
  }

  shouldSkipInjection(
    sessionID: string,
    nowMs: number,
    ttlMs = 30_000
  ): boolean {
    const state = this.stateMap.get(sessionID);
    if (!state?.isCompacting) return false;

    // Preserve existing behavior: missing timestamp means "still compacting".
    if (!state.compactingSince) {
      return true;
    }

    const expired = nowMs - state.compactingSince > ttlMs;
    if (!expired) {
      return true;
    }

    this.upsert(sessionID, s => {
      s.isCompacting = false;
    });

    return false;
  }

  private createDefaultState(): SessionState {
    // Match existing semantics: tick increments on creation, then again on upsert.
    return {
      contextPaths: new Set<string>(),
      lastUpdated: ++this.tick,
      seededFromHistory: false,
      seedCount: 0,
    };
  }
}

export function createSessionStore(opts?: SessionStoreOptions): SessionStore {
  return new SessionStore(opts ?? { max: 100 });
}
