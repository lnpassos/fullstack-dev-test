import { describe, expect, it } from 'vitest';
import { MemoryCache } from '../../src/adapters/outbound/cache/memoryCache.js';

/** The cache is a cost control: every hit is a generation not paid for. */
describe('MemoryCache', () => {
  it('returns a stored value', () => {
    const cache = new MemoryCache<string>({ maxEntries: 10, ttlMs: 1000 });
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');
  });

  it('returns undefined for an unknown key', () => {
    const cache = new MemoryCache<string>({ maxEntries: 10, ttlMs: 1000 });
    expect(cache.get('missing')).toBeUndefined();
  });

  it('expires an entry once its TTL has passed', () => {
    const clock = { value: 0 };
    const cache = new MemoryCache<string>({ maxEntries: 10, ttlMs: 1000, now: () => clock.value });

    cache.set('k', 'v');
    clock.value = 999;
    expect(cache.get('k')).toBe('v');

    clock.value = 1000;
    expect(cache.get('k')).toBeUndefined();
    // The expired entry is dropped, not merely hidden.
    expect(cache.size).toBe(0);
  });

  it('evicts the least recently used entry when full', () => {
    const cache = new MemoryCache<string>({ maxEntries: 2, ttlMs: 10_000 });

    cache.set('a', '1');
    cache.set('b', '2');
    cache.get('a'); // 'a' becomes the most recently used, so 'b' is next out.
    cache.set('c', '3');

    expect(cache.get('a')).toBe('1');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('3');
  });

  it('never grows past its bound', () => {
    const cache = new MemoryCache<number>({ maxEntries: 3, ttlMs: 10_000 });
    for (let i = 0; i < 100; i += 1) cache.set(`k${i}`, i);
    expect(cache.size).toBeLessThanOrEqual(3);
  });
});
