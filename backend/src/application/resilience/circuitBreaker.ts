export type BreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Consecutive failures that trip the breaker. */
  readonly failureThreshold: number;
  /** How long to stay open before allowing a probe. */
  readonly resetMs: number;
  /** Injected in tests so state transitions can be driven without waiting. */
  readonly now?: () => number;
  readonly onStateChange?: (from: BreakerState, to: BreakerState) => void;
}

/**
 * Circuit breaker around the LLM provider.
 *
 * Retries alone make a provider outage *more* expensive: every request pays the
 * full timeout budget several times over before degrading, so the client waits
 * ~25s to receive the same fallback it could have had instantly, while we keep
 * pounding an upstream that is trying to recover — and, on a metered API, keep
 * paying for attempts that will not succeed.
 *
 * Once the breaker is open the caller skips the provider entirely and serves the
 * fallback in single-digit milliseconds. After `resetMs` a single probe is
 * allowed through: if it succeeds normal service resumes, if it fails the
 * breaker re-opens for another interval.
 */
export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  /** Guards the half-open state so exactly one probe is in flight. */
  private probeInFlight = false;

  private readonly failureThreshold: number;
  private readonly resetMs: number;
  private readonly now: () => number;
  private readonly onStateChange: ((from: BreakerState, to: BreakerState) => void) | undefined;

  constructor(options: CircuitBreakerOptions) {
    this.failureThreshold = options.failureThreshold;
    this.resetMs = options.resetMs;
    this.now = options.now ?? Date.now;
    this.onStateChange = options.onStateChange;
  }

  /** Current state, after applying any pending open → half-open transition. */
  get currentState(): BreakerState {
    this.refresh();
    return this.state;
  }

  /** False means: do not call the provider, go straight to the fallback. */
  canAttempt(): boolean {
    this.refresh();

    if (this.state === 'closed') return true;
    if (this.state === 'open') return false;

    // half-open: admit a single probe, hold everyone else back.
    if (this.probeInFlight) return false;
    this.probeInFlight = true;
    return true;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.probeInFlight = false;
    if (this.state !== 'closed') this.transitionTo('closed');
  }

  recordFailure(): void {
    this.probeInFlight = false;

    // A failed probe means the upstream is still unhealthy: re-open immediately
    // rather than spending another `failureThreshold` requests finding out.
    if (this.state === 'half-open') {
      this.trip();
      return;
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) this.trip();
  }

  private trip(): void {
    this.openedAt = this.now();
    this.consecutiveFailures = 0;
    this.transitionTo('open');
  }

  private refresh(): void {
    if (this.state === 'open' && this.now() - this.openedAt >= this.resetMs) {
      this.probeInFlight = false;
      this.transitionTo('half-open');
    }
  }

  private transitionTo(next: BreakerState): void {
    if (this.state === next) return;
    const previous = this.state;
    this.state = next;
    this.onStateChange?.(previous, next);
  }
}
