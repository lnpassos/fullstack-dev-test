import { Router } from 'express';
import type { Response } from 'express';
import type { SuggestionCatalogue } from '../../../../application/ports/suggestionCatalogue.js';
import type { SuggestMessages } from '../../../../application/suggestMessages.js';
import { AppError } from '../../../../domain/errors.js';
import { suggestionRequestSchema, toSuggestionQuery, toValidationDetails } from '../validation.js';

/**
 * `POST /suggestions`
 *
 * POST rather than GET even though the call is read-only and idempotent: the
 * inputs are user-authored free text, and a GET would put them in a URL, where
 * they land in access logs, proxy logs and browser history. The cost is losing
 * HTTP-level caching, which a GET would have made available all the way out to
 * a CDN — a real trade-off, discussed in the README. Server-side caching
 * recovers most of that benefit without the logging exposure.
 */
export function suggestionsRouter(
  suggestMessages: SuggestMessages,
  catalogue: SuggestionCatalogue,
): Router {
  const router = Router();

  router.post('/suggestions', async (req, res) => {
    const parsed = suggestionRequestSchema.safeParse(req.body);

    // A rejected request never reaches the provider, and never degrades to the
    // fallback either: bad input is the caller's problem to fix, and quietly
    // answering it with generic messages would hide a client bug.
    if (!parsed.success) {
      throw AppError.validation(
        'The request could not be processed.',
        toValidationDetails(parsed.error),
      );
    }

    const startedAt = process.hrtime.bigint();
    const result = await suggestMessages(toSuggestionQuery(parsed.data), abortSignalFor(res));
    const latencyMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);

    req.log.info(
      { source: result.source, degraded: result.degraded, latencyMs, count: result.suggestions.length },
      'Suggestions served',
    );

    // 200 on the fallback path as well. See `suggestMessages` for the reasoning;
    // `meta.source` and `meta.degraded` are how a client tells the difference.
    res.status(200).json({
      suggestions: result.suggestions,
      meta: {
        source: result.source,
        degraded: result.degraded,
        model: result.model ?? null,
        requestId: req.id,
        latencyMs,
      },
    });
  });

  /**
   * `GET /options` — the vocabulary the UI offers in its pickers.
   *
   * Server-owned so that adding an occasion does not require shipping a new
   * build of the app. The API still accepts any free text; these are
   * suggestions, not an allowlist.
   *
   * Every value offered here is one the curated fallback also resolves, so
   * choosing from the dropdown still produces an occasion-specific card when the
   * model is unavailable.
   */
  router.get('/options', (_req, res) => {
    res.status(200).json(catalogue.optionsFor());
  });

  return router;
}

/**
 * Propagates a client disconnect down to the provider call.
 *
 * If the app is closed mid-request there is no one left to receive the answer;
 * aborting stops us paying for a generation nobody will read.
 *
 * Watches the response rather than the request: `req` also emits `close` once
 * its body has been fully read, which for a normal request happens long before
 * we are done — listening there would abort every call the moment the body
 * parser finished. `res` emits `close` when the exchange ends, and
 * `writableEnded` separates "we answered" from "they hung up".
 */
function abortSignalFor(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}
