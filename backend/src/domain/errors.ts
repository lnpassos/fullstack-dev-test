/**
 * Error taxonomy.
 *
 * Two distinct hierarchies, deliberately kept apart:
 *
 * - `AppError` is what the HTTP layer is allowed to show a client. Its message
 *   is curated copy, never an upstream string.
 * - `LlmError` is an internal classification of *why* the provider call failed.
 *   It never reaches the client; it decides whether we retry, whether we trip
 *   the circuit breaker, and at which level we log.
 *
 * Keeping them separate is what makes "never expose raw errors" enforceable by
 * construction rather than by remembering to sanitise at each call site.
 */

/**
 * Declared as a runtime array rather than a bare union so the set can be
 * compared against `openapi.yaml` by a test. A documented contract that nothing
 * checks drifts from the implementation the first time someone is in a hurry.
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
  'PAYLOAD_TOO_LARGE',
  'NOT_FOUND',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Machine-readable reason a field was rejected.
 *
 * The accompanying `message` is English written for a developer reading logs. A
 * client with more than one locale cannot localise an English sentence, so the
 * rule is what it branches on — the same reason `ErrorCode` exists alongside
 * `error.message`.
 */
export const VALIDATION_RULES = [
  'required',
  'too_short',
  'too_long',
  'invalid_format',
  'invalid_value',
  'unknown_field',
] as const;

export type ValidationRule = (typeof VALIDATION_RULES)[number];

/** One rejected field, safe to return: it describes our rules, not our internals. */
export interface ValidationDetail {
  readonly field: string;
  readonly rule: ValidationRule;
  /** English, developer-facing. Clients localise from `rule`. */
  readonly message: string;
}

export interface AppErrorOptions {
  /** Field-level detail, safe to echo back (produced by our own validation). */
  readonly details?: readonly unknown[];
  /** Original error, kept for logs only. Never serialised to the client. */
  readonly cause?: unknown;
}

/** An error whose public shape has been deliberately chosen. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: readonly unknown[] | undefined;

  constructor(
    code: ErrorCode,
    httpStatus: number,
    publicMessage: string,
    options: AppErrorOptions = {},
  ) {
    super(publicMessage, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = options.details;
  }

  static validation(message: string, details?: readonly unknown[]): AppError {
    return new AppError('VALIDATION_ERROR', 400, message, details ? { details } : {});
  }

  static notFound(message = 'Resource not found.'): AppError {
    return new AppError('NOT_FOUND', 404, message);
  }

  static rateLimited(message = 'Too many requests. Please retry shortly.'): AppError {
    return new AppError('RATE_LIMITED', 429, message);
  }

  /**
   * Reserved for the case where even the fallback could not be produced.
   * The normal LLM-failure path does NOT use this — it degrades to templates
   * and still answers 200. See `suggestMessages`.
   */
  static upstreamUnavailable(message = 'Suggestions are temporarily unavailable.'): AppError {
    return new AppError('UPSTREAM_UNAVAILABLE', 503, message);
  }

  static internal(cause?: unknown): AppError {
    return new AppError('INTERNAL_ERROR', 500, 'An unexpected error occurred.', { cause });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Why a provider call failed.
 *
 * `retryable` encodes a policy decision per kind:
 *
 * - timeout / server_error / network_error / rate_limited are transient; the
 *   same request may well succeed moments later, so we retry with backoff.
 * - auth_error is a deployment misconfiguration. Retrying cannot fix a bad key,
 *   it only multiplies the latency of a request that is already doomed, so we
 *   fail fast and log at `error` for alerting.
 * - content_filtered is a deterministic model decision. The same prompt will be
 *   refused again; retrying wastes tokens.
 * - invalid_output gets exactly one corrective retry, handled inside the
 *   provider adapter rather than here, because the second attempt uses a
 *   different (stricter) prompt rather than the identical request.
 */
export type LlmFailureKind =
  | 'timeout'
  | 'rate_limited'
  | 'server_error'
  | 'network_error'
  | 'auth_error'
  | 'content_filtered'
  | 'invalid_output'
  | 'unknown';

const RETRYABLE_KINDS: ReadonlySet<LlmFailureKind> = new Set<LlmFailureKind>([
  'timeout',
  'rate_limited',
  'server_error',
  'network_error',
]);

export interface LlmErrorOptions {
  readonly status?: number;
  /** Honoured from the provider's `Retry-After` header when present. */
  readonly retryAfterMs?: number;
  readonly cause?: unknown;
}

export class LlmError extends Error {
  readonly kind: LlmFailureKind;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(kind: LlmFailureKind, message: string, options: LlmErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'LlmError';
    this.kind = kind;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }

  get retryable(): boolean {
    return RETRYABLE_KINDS.has(this.kind);
  }
}

export function isLlmError(error: unknown): error is LlmError {
  return error instanceof LlmError;
}

/** Maps an HTTP status from any provider onto our failure taxonomy. */
export function classifyHttpStatus(status: number): LlmFailureKind {
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'unknown';
}
