import type { Cache } from '../../../application/ports/cache.js';

export interface MemoryCacheOptions {
  readonly maxEntries: number;
  readonly ttlMs: number;
  /** Injected in tests to expire entries without waiting. */
  readonly now?: () => number;
}

interface Entry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

/**
 * In-process LRU cache with per-entry TTL.
 *
 * In-process is the right scope for this test and the wrong scope for
 * production: with more than one instance the hit rate falls off roughly as
 * 1/instances, and a deploy empties it. It is used here because it has no
 * infrastructure cost and demonstrates the caching decision; the `Cache` port
 * exists so that swapping in Redis or a Firestore collection is a change at the
 * composition root only.
 *
 * Recency is tracked by exploiting `Map`'s insertion order: re-inserting on read
 * moves an entry to the back, so the oldest key is always the first one.
 */
export class MemoryCache<T> implements Cache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: MemoryCacheOptions) {
    this.maxEntries = options.maxEntries;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    // Refresh recency.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    // Delete first so an overwrite also counts as "most recently used".
    this.entries.delete(key);

    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }

    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
