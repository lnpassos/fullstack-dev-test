import { isLlmError } from '../domain/errors.js';
import type { Suggestion, SuggestionQuery, SuggestionResult } from '../domain/suggestion.js';
import { SUGGESTION_LIMITS } from '../domain/suggestion.js';
import { normalizeForKey } from '../domain/textNormalization.js';
import { sampleWithoutReplacement } from '../shared/randomSample.js';
import type { CircuitBreaker } from './resilience/circuitBreaker.js';
import { withRetry } from './resilience/retry.js';
import { withTimeout } from './resilience/timeout.js';
import type { Cache } from './ports/cache.js';
import type { SuggestionCatalogue } from './ports/suggestionCatalogue.js';
import type { Logger } from './ports/logger.js';
import type { LlmProvider } from './ports/llmProvider.js';

/**
 * The single place where "what happens when the LLM misbehaves" is decided.
 *
 * The policy, in order:
 *
 *   cache hit                 → serve it, no provider call, no cost
 *   circuit open              → serve the fallback immediately, no provider call
 *   provider succeeds         → serve it, cache it
 *   provider fails, retryably → retry with jittered backoff, then as below
 *   provider fails            → serve the fallback, degraded = true
 *
 * The fallback branch answers 200, not 5xx. The caller asked for gift card
 * messages and receives gift card messages that are safe to print; the fact
 * that a machine did not write them is a quality difference, not a failure of
 * the request. Signalling it in `meta.source` lets the client say so in the UI
 * while keeping the primary flow working — which is exactly the behaviour a
 * user in the middle of buying a gift card needs.
 *
 * The alternative — 503, forcing the client to handle it — was rejected because
 * it turns a provider's bad afternoon into a broken checkout for us, and because
 * every client would then have to reimplement this same fallback locally.
 */

export interface SuggestMessagesDeps {
  readonly provider: LlmProvider;
  /**
   * Injected rather than imported: the application decides *when* to degrade,
   * the catalogue decides *what* to say. Also lets tests pin the messages.
   */
  readonly catalogue: SuggestionCatalogue;
  /** `null` disables caching (CACHE_ENABLED=false). */
  readonly cache: Cache<readonly string[]> | null;
  readonly breaker: CircuitBreaker;
  readonly logger: Logger;
  /** Deadline for one provider call. */
  readonly timeoutMs: number;
  readonly maxRetries: number;
  /** Deadline for the whole request, across every attempt. */
  readonly totalBudgetMs: number;
  /** Injected in tests to avoid real backoff delays. */
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
}

export type SuggestMessages = (
  query: SuggestionQuery,
  signal?: AbortSignal,
) => Promise<SuggestionResult>;

/**
 * Cache key.
 *
 * Includes the prompt version and the model because a message generated under
 * different instructions, or by a different model, is a different product and
 * must not be served from an old entry. Occasion and relationship are folded to
 * a case-insensitive form so that "Birthday" and "birthday" share one entry —
 * the input space is small and highly repetitive, which is what makes caching so
 * effective for this particular feature.
 */
function cacheKey(query: SuggestionQuery, provider: LlmProvider): string {
  return [
    provider.promptVersion,
    provider.modelId,
    query.tone,
    normalizeForKey(query.occasion),
    normalizeForKey(query.relationship),
  ].join('|');
}

function toSuggestions(messages: readonly string[]): Suggestion[] {
  return messages.map((text, index) => ({ id: `s_${index + 1}`, text }));
}

export function createSuggestMessages(deps: SuggestMessagesDeps): SuggestMessages {
  const {
    provider,
    catalogue,
    cache,
    breaker,
    logger,
    timeoutMs,
    maxRetries,
    totalBudgetMs,
    sleep,
  } = deps;

  const serveFallback = (query: SuggestionQuery, reason: string): SuggestionResult => {
    logger.warn({ reason, occasion: query.occasion }, 'Serving fallback suggestions');
    return {
      suggestions: toSuggestions(
        // The reader chose a language; a degraded answer is still an answer and
        // has to arrive in it. Serving English cards under a translated
        // "unavailable" notice is worse than the outage it covers for.
        catalogue.fallbackMessagesFor(query.occasion, query.relationship, query.count),
      ),
      source: 'fallback',
      degraded: true,
      model: undefined,
    };
  };

  return async function suggestMessages(query, signal) {
    const key = cacheKey(query, provider);

    const cached = cache?.get(key);
    if (cached) {
      logger.debug({ key }, 'Cache hit');
      return {
        // Cached entries hold everything the model returned; serving a random
        // subset means a popular combination does not show every user the exact
        // same card for the lifetime of the entry.
        suggestions: toSuggestions(sampleWithoutReplacement(cached, query.count)),
        source: 'cache',
        degraded: false,
        model: provider.modelId,
      };
    }

    // An open breaker means recent calls have been failing consistently. Skip
    // the provider entirely: the client gets an answer in milliseconds instead
    // of after the full retry budget, and the recovering upstream gets a break.
    if (!breaker.canAttempt()) {
      return serveFallback(query, 'circuit_open');
    }

    const deadlineAt = Date.now() + totalBudgetMs;

    try {
      const messages = await withRetry(
        () =>
          withTimeout(
            (timeoutSignal) => provider.generateMessages(query, timeoutSignal),
            // A later attempt gets whatever is left of the overall budget, never
            // the full per-call allowance: the last attempt must not be able to
            // overrun the deadline it was started under.
            Math.min(timeoutMs, Math.max(1, deadlineAt - Date.now())),
            signal,
          ),
        {
          maxRetries,
          deadlineAt,
          ...(sleep ? { sleep } : {}),
          onRetry: ({ attempt, delayMs, error }) => {
            logger.warn(
              { attempt, delayMs, kind: error.kind, status: error.status },
              'Retrying provider call',
            );
          },
        },
      );

      breaker.recordSuccess();
      // Cache what the model actually produced, up to the schema maximum.
      cache?.set(key, messages.slice(0, SUGGESTION_LIMITS.maxCount));

      return {
        suggestions: toSuggestions(messages.slice(0, query.count)),
        source: 'llm',
        degraded: false,
        model: provider.modelId,
      };
    } catch (error) {
      breaker.recordFailure();

      const kind = isLlmError(error) ? error.kind : 'unknown';

      // A bad key is a deployment problem that no amount of degrading fixes, so
      // it is logged loudly enough to alert on. Everything else is expected
      // weather for a third-party dependency and stays at `warn`.
      const context = {
        kind,
        status: isLlmError(error) ? error.status : undefined,
        err: error,
      };
      if (kind === 'auth_error') {
        logger.error(context, 'Provider rejected our credentials');
      } else {
        logger.warn(context, 'Provider call failed');
      }

      return serveFallback(query, kind);
    }
  };
}
