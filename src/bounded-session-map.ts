/**
 * Internal bounded session map shared by runtime call sites that keep
 * tick-stamped per-session entries. The tick counter stays private;
 * callers stamp recency only through ensure/touch, which auto-evict.
 */

interface BoundedSessionMapOptions {
  /** Maximum retained sessions. Defaults to 100; clamps to at least 1. */
  max?: number;
  /** Optional protection predicate; entries returning false are never evicted. */
  isEvictable?: (sessionID: string) => boolean;
}

const DEFAULT_MAX = 100;

interface Entry<T> {
  /** Monotonic recency stamp; maintained only by ensure/touch. */
  tick: number;
  value: T;
}

export class BoundedSessionMap<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly isEvictable: (sessionID: string) => boolean;
  private max: number;
  private tick = 0;

  constructor(options: BoundedSessionMapOptions = {}) {
    this.max = Math.max(1, options.max ?? DEFAULT_MAX);
    this.isEvictable = options.isEvictable ?? (() => true);
  }

  /** Return the existing entry or create it via `create`, then evict. */
  ensure(sessionID: string, create: () => T): T {
    let entry = this.entries.get(sessionID);
    if (!entry) {
      entry = { tick: 0, value: create() };
      this.entries.set(sessionID, entry);
    }
    entry.tick = ++this.tick;
    this.evict();
    return entry.value;
  }

  /** Stamp the entry if present, then evict. Never creates entries. */
  touch(sessionID: string): void {
    const entry = this.entries.get(sessionID);
    if (!entry) return;
    entry.tick = ++this.tick;
    this.evict();
  }

  /** Run the eviction scan alone without stamping anything. */
  evict(): void {
    while (this.entries.size > this.max) {
      let evictableID: string | undefined;
      let oldestTick = Infinity;
      for (const [sessionID, entry] of this.entries) {
        if (!this.isEvictable(sessionID)) continue;
        // Strict < keeps the first-seen entry on tick ties.
        if (entry.tick < oldestTick) {
          oldestTick = entry.tick;
          evictableID = sessionID;
        }
      }
      if (!evictableID) return;
      this.entries.delete(evictableID);
    }
  }

  setMax(limit: number): void {
    this.max = Math.max(1, limit);
  }

  ids(): string[] {
    return Array.from(this.entries.keys());
  }

  reset(): void {
    this.entries.clear();
    this.max = DEFAULT_MAX;
    this.tick = 0;
  }
}
