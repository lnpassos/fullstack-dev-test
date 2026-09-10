import { pino } from 'pino';
import type { Logger } from '../../../application/ports/logger.js';
import type { Env } from '../../../config/env.js';

/**
 * Structured JSON logging.
 *
 * Two rules this configuration enforces:
 *
 * - Secrets never reach a log line. `redact` covers the header and field names
 *   that carry credentials, so a provider error that happens to echo a request
 *   header cannot leak the API key into stdout — where it would then be shipped
 *   to whatever log aggregator the deployment uses and outlive the incident.
 * - User input is not logged by default. `occasion` and `relationship` are
 *   free text typed by a person; they are low-risk, but logging user-supplied
 *   strings by reflex is how PII ends up in log storage. The request id is
 *   enough to correlate a report with a line here.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-goog-api-key"]',
  '*.apiKey',
  '*.api_key',
  '*.GEMINI_API_KEY',
];

export function createLogger(env: Env): Logger {
  return pino({
    level: env.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    base: { service: 'gift-message-suggester' },
    // Pretty output is a development convenience; production wants one JSON
    // object per line for the log pipeline to parse.
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: false } } }
      : {}),
  }) satisfies Logger;
}
