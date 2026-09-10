import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { silentLogger } from '../../src/application/ports/logger.js';
import { AppError } from '../../src/domain/errors.js';
import { errorHandler, notFoundHandler } from '../../src/adapters/inbound/http/middleware/errorHandler.js';
import { requestContext } from '../../src/adapters/inbound/http/middleware/requestContext.js';

/**
 * The error handler is the guarantee behind "the backend must not expose raw
 * errors to the client". Worth testing directly, with errors that no route in
 * this application would normally produce.
 */
function appThatThrows(error: unknown) {
  const app = express();
  app.use(requestContext(silentLogger));
  app.use(express.json({ limit: '1kb' }));
  app.get('/boom', () => {
    throw error;
  });
  app.use(notFoundHandler());
  app.use(errorHandler());
  return app;
}

describe('errorHandler', () => {
  it('answers an unexpected error with a generic 500', async () => {
    const leaky = new Error('connection to internal-db-7.prod failed at 10.0.0.4');
    const response = await request(appThatThrows(leaky)).get('/boom').expect(500);

    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(response.body.error.message).toBe('An unexpected error occurred.');

    // The interesting assertion: nothing about the internals survives.
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toMatch(/internal-db-7|10\.0\.0\.4|at Object|node_modules/);
  });

  it('still returns a correlation id on a 500', async () => {
    const response = await request(appThatThrows(new Error('x'))).get('/boom').expect(500);

    // The id is the one internal detail we do hand over: it is how a user report
    // gets matched to the log line that has the real error in it.
    expect(response.body.error.requestId).toBeTruthy();
    expect(response.headers['x-request-id']).toBe(response.body.error.requestId);
  });

  it('passes an AppError through with its curated message', async () => {
    const response = await request(appThatThrows(AppError.validation('Occasion is required.')))
      .get('/boom')
      .expect(400);

    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Occasion is required.',
    });
  });

  it('does not attach a details array when there is none', async () => {
    const response = await request(appThatThrows(AppError.notFound())).get('/boom').expect(404);
    expect(response.body.error.details).toBeUndefined();
  });

  it('answers 413 for a body past the parser limit', async () => {
    const app = appThatThrows(new Error('unused'));
    const response = await request(app)
      .post('/boom')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ occasion: 'x'.repeat(2000) }))
      .expect(413);

    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('answers 400 for a malformed JSON body', async () => {
    const response = await request(appThatThrows(new Error('unused')))
      .post('/boom')
      .set('Content-Type', 'application/json')
      .send('{"occasion":')
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('uses the same envelope for an unmatched route', async () => {
    const response = await request(appThatThrows(new Error('unused'))).get('/nothing').expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.requestId).toBeTruthy();
  });
});
