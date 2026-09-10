import { describe, expect, it } from 'vitest';
import { silentLogger } from '../../src/application/ports/logger.js';
import { createSuggestMessages } from '../../src/application/suggestMessages.js';
import type { SuggestionQuery } from '../../src/domain/suggestion.js';
import { MemoryCache } from '../../src/adapters/outbound/cache/memoryCache.js';
import { createCuratedCatalogue } from '../../src/adapters/outbound/catalogue/curatedCatalogue.js';
import { FakeLlmProvider, failingProvider } from '../../src/adapters/outbound/llm/fakeProvider.js';
import { CircuitBreaker } from '../../src/application/resilience/circuitBreaker.js';

/**
 * The degradation policy itself, isolated from HTTP. These tests pin the
 * decisions the README argues for, so a future change to that policy has to be
 * a deliberate one.
 */

const query: SuggestionQuery = {
  occasion: 'Birthday',
  relationship: 'Friend',
  tone: 'warm',
  count: 3,
};

function build(
  provider: FakeLlmProvider,
  options: { cache?: MemoryCache<readonly string[]>; breaker?: CircuitBreaker; maxRetries?: number } = {},
) {
  const breaker =
    options.breaker ?? new CircuitBreaker({ failureThreshold: 3, resetMs: 1000 });

  const suggestMessages = createSuggestMessages({
    provider,
    // The real catalogue, deterministically sampled: these tests assert on the
    // degradation policy, not on which of the safe messages came out.
    catalogue: createCuratedCatalogue({ pick: (pool, count) => [...pool].slice(0, count) }),
    cache: options.cache ?? null,
    breaker,
    logger: silentLogger,
    timeoutMs: 1000,
    maxRetries: options.maxRetries ?? 0,
    totalBudgetMs: 10_000,
    sleep: async () => {},
  });

  return { suggestMessages, breaker };
}

describe('suggestMessages', () => {
  it('serves provider output when the call succeeds', async () => {
    const { suggestMessages } = build(new FakeLlmProvider());
    const result = await suggestMessages(query);

    expect(result.source).toBe('llm');
    expect(result.degraded).toBe(false);
    expect(result.model).toBe('fake-model-v1');
  });

  it('degrades to curated messages when the provider fails', async () => {
    const { suggestMessages } = build(failingProvider('server_error', 500));
    const result = await suggestMessages(query);

    expect(result.source).toBe('fallback');
    expect(result.degraded).toBe(true);
    // There is no model behind a curated message, and claiming one would be a lie
    // in the telemetry.
    expect(result.model).toBeUndefined();
    expect(result.suggestions).toHaveLength(3);
  });

  it('assigns a stable id to every suggestion', async () => {
    const { suggestMessages } = build(new FakeLlmProvider());
    const result = await suggestMessages(query);
    expect(result.suggestions.map((s) => s.id)).toEqual(['s_1', 's_2', 's_3']);
  });

  describe('caching', () => {
    it('avoids a second provider call for an equivalent query', async () => {
      const provider = new FakeLlmProvider();
      const cache = new MemoryCache<readonly string[]>({ maxEntries: 10, ttlMs: 60_000 });
      const { suggestMessages } = build(provider, { cache });

      await suggestMessages(query);
      const second = await suggestMessages({ ...query, occasion: 'BIRTHDAY  ' });

      expect(second.source).toBe('cache');
      expect(provider.callCount).toBe(1);
    });

    it('does not cache the fallback', async () => {
      const provider = failingProvider('timeout');
      const cache = new MemoryCache<readonly string[]>({ maxEntries: 10, ttlMs: 60_000 });
      const { suggestMessages } = build(provider, { cache });

      await suggestMessages(query);

      // Caching a degraded answer would extend one provider blip into an hour of
      // generic suggestions for that combination.
      expect(cache.size).toBe(0);
    });

    it('treats a different tone as a different entry', async () => {
      const provider = new FakeLlmProvider();
      const cache = new MemoryCache<readonly string[]>({ maxEntries: 10, ttlMs: 60_000 });
      const { suggestMessages } = build(provider, { cache });

      await suggestMessages(query);
      await suggestMessages({ ...query, tone: 'funny' });

      expect(provider.callCount).toBe(2);
    });
  });

  describe('circuit breaker', () => {
    it('stops calling the provider once the circuit opens', async () => {
      const provider = failingProvider('server_error', 500);
      const breaker = new CircuitBreaker({ failureThreshold: 2, resetMs: 60_000 });
      const { suggestMessages } = build(provider, { breaker });

      await suggestMessages(query);
      await suggestMessages(query);
      expect(provider.callCount).toBe(2);

      // Circuit is open: this one should never reach the provider.
      const third = await suggestMessages(query);

      expect(third.source).toBe('fallback');
      expect(third.degraded).toBe(true);
      expect(provider.callCount).toBe(2);
    });

    it('still answers 2-3 usable suggestions while the circuit is open', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 1, resetMs: 60_000 });
      const { suggestMessages } = build(failingProvider('timeout'), { breaker });

      await suggestMessages(query);
      const degraded = await suggestMessages(query);

      expect(degraded.suggestions.length).toBeGreaterThanOrEqual(2);
      for (const suggestion of degraded.suggestions) {
        expect(suggestion.text).toMatch(/\S/);
      }
    });

    it('recovers once the provider comes back', async () => {
      const clock = { value: 0 };
      const provider = new FakeLlmProvider((_query, attempt) => {
        if (attempt <= 2) throw new Error('down');
        return ['Back in service.', 'All good again.'];
      });
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetMs: 1000,
        now: () => clock.value,
      });
      const { suggestMessages } = build(provider, { breaker });

      await suggestMessages(query);
      await suggestMessages(query);
      expect((await suggestMessages(query)).source).toBe('fallback');

      clock.value += 1000; // reset window elapsed: one probe is admitted
      const recovered = await suggestMessages(query);

      expect(recovered.source).toBe('llm');
      expect(breaker.currentState).toBe('closed');
    });
  });
});
