import type { RuleSnapshot } from './rule-discovery.js';
import { BoundedSessionMap } from './bounded-session-map.js';
export interface SessionState {
  /** Working context: monotonic set of observed file paths. Only
   * SessionWorkingContext production code reads or mutates these fields. */
  workingContextPaths: Set<string>;
  lastUserPrompt?: string;
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
  private readonly states: BoundedSessionMap<SessionState>;

  constructor(opts: SessionStoreOptions = {}) {
    this.states = new BoundedSessionMap<SessionState>({
      max: opts.max ?? 100,
    });
  }

  setMax(limit: number): void {
    this.states.setMax(limit);
  }

  ids(): string[] {
    return this.states.ids();
  }

  get(sessionID: string): SessionState | undefined {
    return this.states.get(sessionID);
  }

  snapshot(sessionID: string): SessionState | undefined {
    const s = this.states.get(sessionID);
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
    this.states.reset();
  }

  upsert(sessionID: string, mutator: (state: SessionState) => void): void {
    const state = this.states.ensure(sessionID, () =>
      this.createDefaultState()
    );
    mutator(state);
  }

  private createDefaultState(): SessionState {
    return {
      workingContextPaths: new Set<string>(),
      workingContextSeeded: false,
    };
  }
}
