import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { bootstrap } from 'gift-message-suggester-backend/bootstrap';
import { loadEnv } from 'gift-message-suggester-backend/config/env';

/**
 * Cloud Functions deploy adapter.
 *
 * This is the whole thing. The service is an Express application built by
 * `bootstrap()`, and a v2 HTTPS function takes an Express app directly — so
 * running on Functions instead of a container is a change of entry point, not a
 * change of architecture. The handler below is the same object the integration
 * tests drive through supertest.
 *
 * Kept as a separate npm package rather than a file inside `backend/src`
 * deliberately: a service should not depend on the SDK of its deployment
 * target. Installing `firebase-functions` into the main backend pulls in the
 * whole `firebase-admin` tree, which the running service never uses, and which
 * carries advisories it has no reason to carry. Anyone who only wants to run the
 * API never installs any of it.
 *
 * Not deployed as part of this exercise — there is no Firebase project behind
 * it — so treat it as a compiled, reviewed deploy path rather than a verified
 * one. The README says the same.
 */

/**
 * Declared as a Secret Manager secret rather than a plain environment variable.
 * Function configuration is visible to anyone with console access; a secret is
 * mounted at runtime and audited on access.
 */
const geminiApiKey = defineSecret('GEMINI_API_KEY');

export const api = onRequest(
  {
    region: 'southamerica-east1',
    secrets: [geminiApiKey],
    // Small and stateless. Concurrency is high because the request spends
    // almost all of its time waiting on the provider, not on CPU.
    memory: '256MiB',
    concurrency: 40,
    // Comfortably above the provider deadline plus the retry budget, so the
    // platform never cuts a request short of our own fallback.
    timeoutSeconds: 60,
    // One warm instance: a cold start on a container that has to build the
    // Express app is exactly the latency a user notices on the first request.
    minInstances: 0,
    maxInstances: 10,
  },
  // `loadEnv` runs at cold start, so a missing or malformed configuration fails
  // the instance immediately instead of surfacing on the first request.
  bootstrap(loadEnv()).app,
);
