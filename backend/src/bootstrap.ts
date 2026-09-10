import type { Express } from 'express';
import type { Logger } from './application/ports/logger.js';
import type { LlmProvider } from './application/ports/llmProvider.js';
import { createSuggestMessages } from './application/suggestMessages.js';
import type { Env } from './config/env.js';
import { MemoryCache } from './adapters/outbound/cache/memoryCache.js';
import { createCuratedCatalogue } from './adapters/outbound/catalogue/curatedCatalogue.js';
import { FakeLlmProvider } from './adapters/outbound/llm/fakeProvider.js';
import { GeminiProvider } from './adapters/outbound/llm/geminiProvider.js';
import { createLogger } from './adapters/outbound/logging/logger.js';
import { CircuitBreaker } from './application/resilience/circuitBreaker.js';
import { createApp } from './adapters/inbound/http/server.js';

export const APP_VERSION = '1.0.0';

export interface BootstrapOverrides {
  /** Tests inject a scripted provider here; nothing else is stubbed. */
  readonly provider?: LlmProvider;
  readonly logger?: Logger;
  /** Skips real backoff delays in tests. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface Application {
  readonly app: Express;
  readonly logger: Logger;
  readonly breaker: CircuitBreaker;
}

/**
 * Composition root: the one place that knows which concrete adapter satisfies
 * which port. Every other module depends on interfaces, which is what makes the
 * provider swappable and the whole stack testable without a network.
 */
export function bootstrap(env: Env, overrides: BootstrapOverrides = {}): Application {
  const logger = overrides.logger ?? createLogger(env);
  const provider = overrides.provider ?? createProvider(env);

  const cache = env.CACHE_ENABLED
    ? new MemoryCache<readonly string[]>({
        maxEntries: env.CACHE_MAX_ENTRIES,
        ttlMs: env.CACHE_TTL_MS,
      })
    : null;

  const breaker = new CircuitBreaker({
    failureThreshold: env.BREAKER_FAILURE_THRESHOLD,
    resetMs: env.BREAKER_RESET_MS,
    // State changes are the signal worth alerting on: they mark the moment the
    // service started degrading and the moment it recovered.
    onStateChange: (from, to) => {
      logger.warn({ from, to }, 'Circuit breaker state changed');
    },
  });

  const catalogue = createCuratedCatalogue();

  const suggestMessages = createSuggestMessages({
    provider,
    catalogue,
    cache,
    breaker,
    logger,
    timeoutMs: env.LLM_TIMEOUT_MS,
    maxRetries: env.LLM_MAX_RETRIES,
    totalBudgetMs: env.LLM_TOTAL_BUDGET_MS,
    sleep: overrides.sleep,
  });

  const app = createApp({
    env,
    logger,
    suggestMessages,
    catalogue,
    breaker,
    version: APP_VERSION,
  });

  logger.info(
    {
      provider: env.LLM_PROVIDER,
      model: provider.modelId,
      cache: env.CACHE_ENABLED,
      rateLimit: env.RATE_LIMIT_ENABLED,
    },
    'Application constructed',
  );

  return { app, logger, breaker };
}

function createProvider(env: Env): LlmProvider {
  if (env.LLM_PROVIDER === 'fake') return new FakeLlmProvider();

  // `loadEnv` has already refused to start without a key for this provider, so
  // the assertion here is documenting that guarantee rather than trusting input.
  return new GeminiProvider({
    apiKey: env.GEMINI_API_KEY ?? '',
    model: env.GEMINI_MODEL,
    ...(env.GEMINI_THINKING_BUDGET === undefined
      ? {}
      : { thinkingBudget: env.GEMINI_THINKING_BUDGET }),
  });
}
