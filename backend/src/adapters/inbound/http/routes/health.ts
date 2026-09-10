import { Router } from 'express';
import type { CircuitBreaker } from '../../../../application/resilience/circuitBreaker.js';

/**
 * Liveness and readiness, kept separate because they answer different questions
 * and are wired to different machinery.
 *
 * `/health` asks "is this process alive?" — an orchestrator restarts the
 * container when it stops answering.
 *
 * `/ready` asks "should traffic come here?". Notably it stays 200 while the
 * circuit breaker is open: a degraded instance still answers every request
 * correctly, with fallback messages, and pulling it out of the pool would only
 * concentrate the same provider outage onto fewer instances. The breaker state
 * is reported so that monitoring can alert on the degradation without the
 * load balancer acting on it.
 */
export function healthRouter(breaker: CircuitBreaker, version: string): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', version, uptimeSeconds: Math.round(process.uptime()) });
  });

  router.get('/ready', (_req, res) => {
    const state = breaker.currentState;
    res.status(200).json({
      status: state === 'closed' ? 'ready' : 'degraded',
      provider: { circuit: state },
    });
  });

  return router;
}
