import { loadEnv, type Env } from '../../src/config/env.js';

/**
 * Env for tests: the fake provider, no caching and no rate limiting by default,
 * so each test starts from a clean, deterministic state. Individual tests turn
 * the feature they are exercising back on.
 */
export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    LLM_PROVIDER: 'fake',
    CACHE_ENABLED: 'false',
    RATE_LIMIT_ENABLED: 'false',
    LLM_MAX_RETRIES: '0',
    ...overrides,
  });
}

/** Backoff is a policy to test, not a delay to sit through. */
export const noSleep = async (): Promise<void> => {};
