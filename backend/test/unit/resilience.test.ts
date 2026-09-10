import { describe, expect, it, vi } from 'vitest';
import { LlmError } from '../../src/domain/errors.js';
import { CircuitBreaker } from '../../src/application/resilience/circuitBreaker.js';
import { withRetry } from '../../src/application/resilience/retry.js';
import { withTimeout } from '../../src/application/resilience/timeout.js';

const noSleep = async (): Promise<void> => {};

describe('withRetry', () => {
  it('retries a transient failure and returns the eventual success', async () => {
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new LlmError('server_error', 'boom'))
      .mockResolvedValueOnce('ok');

    await expect(withRetry(operation, { maxRetries: 2, sleep: noSleep })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it.each(['timeout', 'rate_limited', 'server_error', 'network_error'] as const)(
    'treats %s as transient',
    async (kind) => {
      const operation = vi.fn(async () => {
        throw new LlmError(kind, 'boom');
      });

      await expect(withRetry(operation, { maxRetries: 2, sleep: noSleep })).rejects.toThrow(
        LlmError,
      );
      expect(operation).toHaveBeenCalledTimes(3); // initial + 2 retries
    },
  );

  it.each(['auth_error', 'content_filtered', 'invalid_output', 'unknown'] as const)(
    'does not retry %s',
    async (kind) => {
      const operation = vi.fn(async () => {
        throw new LlmError(kind, 'boom');
      });

      await expect(withRetry(operation, { maxRetries: 3, sleep: noSleep })).rejects.toThrow(
        LlmError,
      );
      // Retrying a bad key or a refusal only multiplies the latency of a request
      // that was already going to fail.
      expect(operation).toHaveBeenCalledTimes(1);
    },
  );

  it('does not retry an error that is not an LlmError', async () => {
    const operation = vi.fn(async () => {
      throw new TypeError('a bug in an adapter, not a transient fault');
    });

    await expect(withRetry(operation, { maxRetries: 3, sleep: noSleep })).rejects.toThrow(TypeError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('honours the provider Retry-After over its own backoff curve', async () => {
    const delays: number[] = [];
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new LlmError('rate_limited', 'slow down', { retryAfterMs: 1234 }))
      .mockResolvedValueOnce('ok');

    await withRetry(operation, {
      maxRetries: 1,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(delays).toEqual([1234]);
  });

  it('stops retrying once the overall deadline has passed', async () => {
    const operation = vi.fn(async () => {
      throw new LlmError('server_error', 'boom');
    });

    await expect(
      withRetry(operation, {
        maxRetries: 5,
        // Already in the past: no retry can start.
        deadlineAt: Date.now() - 1,
        sleep: noSleep,
      }),
    ).rejects.toThrow(LlmError);

    // The first attempt still runs — the deadline governs retries, not the
    // request itself.
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries while the deadline still allows it', async () => {
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new LlmError('server_error', 'boom'))
      .mockResolvedValueOnce('ok');

    await expect(
      withRetry(operation, { maxRetries: 2, deadlineAt: Date.now() + 60_000, sleep: noSleep }),
    ).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget and rethrows the last error', async () => {
    const operation = vi.fn(async () => {
      throw new LlmError('timeout', 'final');
    });

    await expect(withRetry(operation, { maxRetries: 1, sleep: noSleep })).rejects.toThrow('final');
    expect(operation).toHaveBeenCalledTimes(2);
  });
});

describe('withTimeout', () => {
  it('returns the value when the operation completes in time', async () => {
    await expect(withTimeout(async () => 'ok', 1000)).resolves.toBe('ok');
  });

  it('converts a blown deadline into a classifiable timeout', async () => {
    const hang = (signal: AbortSignal) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      });

    const error = await withTimeout(hang, 10).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe('timeout');
    expect((error as LlmError).retryable).toBe(true);
  });

  it('propagates a caller abort without mislabelling it as a timeout', async () => {
    const controller = new AbortController();
    const hang = (signal: AbortSignal) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted by caller')));
      });

    const promise = withTimeout(hang, 5000, controller.signal);
    controller.abort();

    await expect(promise).rejects.toThrow('aborted by caller');
  });
});

describe('CircuitBreaker', () => {
  /** Controllable clock, so state transitions are driven rather than waited for. */
  function breakerAt(currentTime: { value: number }, threshold = 3, resetMs = 1000) {
    return new CircuitBreaker({
      failureThreshold: threshold,
      resetMs,
      now: () => currentTime.value,
    });
  }

  it('stays closed below the failure threshold', () => {
    const clock = { value: 0 };
    const breaker = breakerAt(clock);

    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.currentState).toBe('closed');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('opens at the threshold and refuses further attempts', () => {
    const clock = { value: 0 };
    const breaker = breakerAt(clock);

    for (let i = 0; i < 3; i += 1) breaker.recordFailure();

    expect(breaker.currentState).toBe('open');
    expect(breaker.canAttempt()).toBe(false);
  });

  it('resets the failure count after a success', () => {
    const clock = { value: 0 };
    const breaker = breakerAt(clock);

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();

    // Only two consecutive failures since the success, so still closed.
    expect(breaker.currentState).toBe('closed');
  });

  it('moves to half-open once the reset interval has passed', () => {
    const clock = { value: 0 };
    const breaker = breakerAt(clock);

    for (let i = 0; i < 3; i += 1) breaker.recordFailure();
    clock.value += 1000;

    expect(breaker.currentState).toBe('half-open');
  });

  it('admits exactly one probe while half-open', () => {
    const clock = { value: 0 };
    const breaker = breakerAt(clock);

    for (let i = 0; i < 3; i += 1) breaker.recordFailure();
    clock.value += 1000;

    expect(breaker.canAttempt()).toBe(true);
    // Everyone else keeps getting the fallback until the probe reports back.
    expect(breaker.canAttempt()).toBe(false);
  });

  it('closes when the probe succeeds', () => {
    const clock = { value: 0 };
    const breaker = breakerAt(clock);

    for (let i = 0; i < 3; i += 1) breaker.recordFailure();
    clock.value += 1000;
    breaker.canAttempt();
    breaker.recordSuccess();

    expect(breaker.currentState).toBe('closed');
  });

  it('re-opens immediately when the probe fails', () => {
    const clock = { value: 0 };
    const breaker = breakerAt(clock);

    for (let i = 0; i < 3; i += 1) breaker.recordFailure();
    clock.value += 1000;
    breaker.canAttempt();
    breaker.recordFailure();

    // One failed probe is enough; it does not need another full threshold.
    expect(breaker.currentState).toBe('open');
    expect(breaker.canAttempt()).toBe(false);
  });

  it('reports state changes for alerting', () => {
    const clock = { value: 0 };
    const transitions: string[] = [];
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetMs: 500,
      now: () => clock.value,
      onStateChange: (from, to) => transitions.push(`${from}->${to}`),
    });

    breaker.recordFailure();
    breaker.recordFailure();
    clock.value += 500;
    breaker.canAttempt();
    breaker.recordSuccess();

    expect(transitions).toEqual(['closed->open', 'open->half-open', 'half-open->closed']);
  });
});
