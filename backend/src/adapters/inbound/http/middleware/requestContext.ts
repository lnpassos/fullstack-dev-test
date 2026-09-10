import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '../../../../application/ports/logger.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlates a client-visible error with the server logs for that request. */
      id: string;
      log: Logger;
    }
  }
}

/**
 * Assigns a request id and a request-scoped child logger.
 *
 * The id is the only internal detail we deliberately expose to clients: error
 * responses carry it and so does the `x-request-id` header, so a user reporting
 * "it failed" hands over a token that points straight at the log lines for that
 * request — without us having to put anything diagnostic in the response body.
 *
 * An inbound `x-request-id` is honoured so a trace survives a gateway or a
 * mobile client that already generates one, but it is length-capped: it ends up
 * in log lines and in a response header, and neither should be attacker-sized.
 */
export function requestContext(logger: Logger) {
  return function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.header('x-request-id');
    req.id = inbound && inbound.length <= 64 ? inbound : randomUUID();
    req.log = logger.child({ requestId: req.id });

    res.setHeader('x-request-id', req.id);
    next();
  };
}

/** Logs one line per completed request: method, route, status and latency. */
export function requestLogging() {
  return function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      req.log.info(
        {
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Math.round(durationMs),
        },
        'request completed',
      );
    });

    next();
  };
}
