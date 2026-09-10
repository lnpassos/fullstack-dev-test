import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from '../../../application/ports/logger.js';
import type { SuggestionCatalogue } from '../../../application/ports/suggestionCatalogue.js';
import type { SuggestMessages } from '../../../application/suggestMessages.js';
import type { Env } from '../../../config/env.js';
import { corsAllowlist } from '../../../config/env.js';
import type { CircuitBreaker } from '../../../application/resilience/circuitBreaker.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';
import { requestContext, requestLogging } from './middleware/requestContext.js';
import { healthRouter } from './routes/health.js';
import { suggestionsRouter } from './routes/suggestions.js';

const API_PREFIX = '/api/v1';

export interface CreateAppDeps {
  readonly env: Env;
  readonly logger: Logger;
  readonly suggestMessages: SuggestMessages;
  readonly catalogue: SuggestionCatalogue;
  readonly breaker: CircuitBreaker;
  readonly version: string;
}

/**
 * Builds the Express application without binding a port.
 *
 * Separating construction from listening is what lets the integration tests
 * drive the real middleware stack — validation, rate limiting, the error
 * envelope — through supertest, instead of testing handlers in isolation and
 * hoping the wiring around them behaves.
 *
 * Middleware order is load-bearing and runs cheapest-first: request context
 * before anything that logs, security headers before any body is touched, body
 * parsing before validation, rate limiting before the handler that costs money.
 */
export function createApp(deps: CreateAppDeps): Express {
  const { env, logger, suggestMessages, catalogue, breaker, version } = deps;
  const app = express();

  // `X-Forwarded-For` is trusted only as far as the deployment actually has
  // proxies in front of it. Trusting it blindly would let any client spoof its
  // own address and walk straight through the per-IP rate limit.
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(requestContext(logger));

  // No browser renders anything from this API, so the restrictive defaults cost
  // nothing. CSP is dropped for the same reason: there is no document to protect.
  app.use(helmet({ contentSecurityPolicy: false }));

  const allowlist = corsAllowlist(env);
  app.use(
    cors({
      origin: allowlist === '*' ? true : allowlist,
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'RateLimit'],
      maxAge: 600,
    }),
  );

  // The largest legitimate request here is a few hundred bytes. Anything past
  // 8 KB is a mistake or an attempt to make the parser do work.
  app.use(express.json({ limit: '8kb' }));
  app.use(requestLogging());

  // Health checks sit outside the rate limiter: a probe must not be throttled by
  // whatever traffic happens to share its address.
  app.use(healthRouter(breaker, version));

  app.use(
    API_PREFIX,
    env.RATE_LIMIT_ENABLED
      ? rateLimitMiddleware(env)
      : (_req, _res, next) => {
          next();
        },
  );
  app.use(API_PREFIX, suggestionsRouter(suggestMessages, catalogue));

  app.use(notFoundHandler());
  app.use(errorHandler());

  return app;
}
