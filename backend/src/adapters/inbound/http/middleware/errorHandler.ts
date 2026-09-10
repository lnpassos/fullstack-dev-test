import type { NextFunction, Request, Response } from 'express';
import { AppError, isAppError } from '../../../../domain/errors.js';

/**
 * The single exit point for every error, and the reason "we never expose raw
 * errors" is a property of the system rather than a habit.
 *
 * Only `AppError` carries a message written for a client. Anything else — a
 * TypeError, a provider SDK object, an Express body-parser failure — is logged
 * in full and answered with a fixed, generic 500. That asymmetry is deliberate:
 * to leak an internal detail, someone would have to go out of their way to wrap
 * it in an `AppError` first.
 */

interface ErrorResponseBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
    readonly details?: readonly unknown[];
  };
}

/** Express recognises an error handler by its four-parameter signature. */
export function errorHandler() {
  return function errorHandlerMiddleware(
    error: unknown,
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    // Headers already sent means the response is mid-flight; Express's default
    // handler is the only thing that can close it cleanly.
    if (res.headersSent) {
      next(error);
      return;
    }

    const appError = toAppError(error);

    // 5xx is our problem and gets a stack; 4xx is the caller's and does not.
    if (appError.httpStatus >= 500) {
      req.log.error({ err: error, code: appError.code }, 'Unhandled error');
    } else {
      req.log.warn({ code: appError.code, status: appError.httpStatus }, 'Request rejected');
    }

    const body: ErrorResponseBody = {
      error: {
        code: appError.code,
        message: appError.message,
        requestId: req.id,
        ...(appError.details ? { details: appError.details } : {}),
      },
    };

    res.status(appError.httpStatus).json(body);
  };
}

function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;

  // express.json() rejects malformed or oversized bodies before any route runs.
  // Those are client mistakes, so they get a 4xx with an actionable message
  // rather than being swept into the generic 500.
  if (error instanceof SyntaxError && 'body' in error) {
    return AppError.validation('Request body is not valid JSON.');
  }
  if (isPayloadTooLarge(error)) {
    return new AppError('PAYLOAD_TOO_LARGE', 413, 'Request body is too large.');
  }

  return AppError.internal(error);
}

function isPayloadTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as { type?: unknown }).type === 'entity.too.large'
  );
}

/** Terminal 404 for unmatched routes, so they use the same envelope as everything else. */
export function notFoundHandler() {
  return function notFoundMiddleware(_req: Request, _res: Response, next: NextFunction): void {
    next(AppError.notFound('Unknown endpoint.'));
  };
}
