import { rateLimit } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { AppError } from '../../../../domain/errors.js';
import type { Env } from '../../../../config/env.js';

/**
 * Per-IP fixed window over the generation endpoint.
 *
 * An unauthenticated endpoint that spends money on every call is the one thing
 * here that genuinely must not be left open: a trivial loop against it costs us
 * real tokens, and a distracted client with a retry bug does the same by
 * accident. The limit is not a security boundary — an attacker with a pool of
 * addresses walks around it — it is a cost ceiling and a blast-radius control.
 *
 * The real boundary in production is authentication: a Firebase Auth uid with a
 * per-user quota, plus App Check to keep the endpoint tied to our own clients.
 * That is out of scope for this test but the middleware slot is the same one.
 *
 * Rejections reuse the standard error envelope, so a client parses a 429 with
 * exactly the code it already has for every other error.
 */
export function rateLimitMiddleware(env: Env): RequestHandler {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX,
    // draft-8 `RateLimit` headers let a well-behaved client back off before it
    // is rejected, rather than discovering the limit by hitting it.
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, _res, next) => {
      req.log.warn({ path: req.originalUrl }, 'Rate limit exceeded');
      next(
        AppError.rateLimited(
          `Too many requests. Please wait a moment and try again (limit: ${env.RATE_LIMIT_MAX} per ${Math.round(env.RATE_LIMIT_WINDOW_MS / 1000)}s).`,
        ),
      );
    },
  });
}
