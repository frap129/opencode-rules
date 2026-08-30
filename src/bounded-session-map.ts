/**
 * Internal bounded session map: the single owner of per-session values for
 * runtime call sites that keep recency-stamped entries. The tick counter
 * stays private; recency changes only through ensure/touch, which
 * auto-evict. Reads via get()/touch()-without-eviction are unstamped.
 */

interface BoundedSessionMapOptions {
  /** Maximum retained sessions. Defaults to 100; clamps to at least 0. */
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
    this.max = Math.max(0, options.max ?? DEFAULT_MAX);
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

  /** Unstamped value read. Returns undefined for missing entries. */
  get(sessionID: string): T | undefined {
    return this.entries.get(sessionID)?.value;
  }

  /** Stamp the entry if present, then evict. Never creates entries.
   * Returns the stamped value, or undefined when the entry is missing. */
  touch(sessionID: string): T | undefined {
    const entry = this.entries.get(sessionID);
    if (!entry) return undefined;
    entry.tick = ++this.tick;
    this.evict();
    return entry.value;
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
    this.max = Math.max(0, limit);
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
