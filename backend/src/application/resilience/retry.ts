import { isLlmError, LlmError } from '../../domain/errors.js';

export interface RetryOptions {
  readonly maxRetries: number;
  /**
   * Epoch ms after which no further attempt may start.
   *
   * Without it the retry budget is per attempt, and the worst case is
   * `(maxRetries + 1) x timeout + backoff` — with the defaults, about 26
   * seconds of a spinner before the user receives a fallback that was available
   * immediately. A deadline bounds what the *caller* experiences, which is the
   * number that actually matters.
   */
  readonly deadlineAt?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  /** Injected in tests to avoid sleeping in real time. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly onRetry?: (info: { attempt: number; delayMs: number; error: LlmError }) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Full jitter (`random(0, exponential)`) rather than plain exponential backoff.
 *
 * When a provider degrades, every one of our instances fails at roughly the same
 * moment. Deterministic backoff makes them all retry at the same moment too,
 * which is precisely the thundering herd that keeps a recovering upstream down.
 * Randomising the whole interval spreads the load out.
 */
function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.round(Math.random() * exponential);
}

/**
 * Retries only what is worth retrying.
 *
 * The decision lives in `LlmError.retryable` (see `domain/errors.ts`), so the
 * policy is stated once, next to the taxonomy it belongs to, instead of being
 * re-derived from status codes at each call site. A non-`LlmError` escaping an
 * adapter is a bug in that adapter, not a transient fault, so it propagates
 * untouched.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const {
    maxRetries,
    deadlineAt,
    baseDelayMs = 200,
    maxDelayMs = 2_000,
    sleep = defaultSleep,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;

      if (!isLlmError(error) || !error.retryable || attempt === maxRetries) {
        throw error;
      }

      // A provider that tells us when to come back knows better than our curve.
      const delayMs = error.retryAfterMs ?? backoffDelay(attempt, baseDelayMs, maxDelayMs);

      // Stop if the retry could not even begin before the deadline. Better to
      // degrade now than to burn the remaining budget on an attempt whose
      // result would arrive too late to be used.
      if (deadlineAt !== undefined && Date.now() + delayMs >= deadlineAt) throw error;

      onRetry?.({ attempt: attempt + 1, delayMs, error });
      await sleep(delayMs);
    }
  }

  throw lastError;
}
