interface BoundedSessionMapOptions {
  /** Maximum retained sessions. Defaults to 100; clamps to at least minBound. */
  max?: number;
  /** Lower clamp for the bound. Defaults to 0; 1 means the map never drains to empty. */
  minBound?: number;
  /** Optional protection predicate; entries returning false are never evicted. */
  isEvictable?: (sessionID: string) => boolean;
}

const DEFAULT_MAX = 100;

interface Entry<T> {
  /** Monotonic recency stamp; maintained only by ensure/touch. */
  tick: number;
  value: T;
}

function clampBound(minBound: number, limit: number): number {
  return Math.max(minBound, limit);
}

export class BoundedSessionMap<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly isEvictable: (sessionID: string) => boolean;
  private readonly minBound: number;
  private max: number;
  private tick = 0;

  constructor(options: BoundedSessionMapOptions = {}) {
    this.minBound = Math.max(0, options.minBound ?? 0);
    this.max = clampBound(this.minBound, options.max ?? DEFAULT_MAX);
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
    this.max = clampBound(this.minBound, limit);
  }

  ids(): string[] {
    return Array.from(this.entries.keys());
  }

  reset(): void {
    this.entries.clear();
    this.max = clampBound(this.minBound, DEFAULT_MAX);
    this.tick = 0;
  }
}
