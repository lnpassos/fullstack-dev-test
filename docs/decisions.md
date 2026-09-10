# Decision log

Each entry records a decision, the alternative that was rejected, and why. The
README summarises these; this file keeps the reasoning at full length so it can
be argued with later.

---

## 1. The fallback path answers HTTP 200, not 503

**Decision.** When the LLM cannot serve a request, the API returns `200` with
curated messages and `meta: { source: "fallback", degraded: true }`.

**Rejected.** `503 Service Unavailable`, leaving the client to decide.

**Why.** The caller asked for gift card messages and receives gift card messages
that are safe to print. That a human wrote them instead of a model is a quality
difference, not a failed request. Someone in the middle of buying a gift card
should not be blocked by our provider having a bad afternoon.

Signalling the degradation in the body rather than the status keeps the primary
flow working while still letting the UI be honest about it — the Flutter app
shows a notice when `degraded` is true.

**The cost, stated plainly.** A client that ignores `meta` cannot tell the two
apart, and a naive monitoring setup that only watches status codes will not see
the outage. We accept this because the alternative pushes a fallback
implementation into every client, and because the outage is visible where it
matters: `meta.source`, the circuit breaker state on `/ready`, and the log line
at `warn`.

**Note.** Invalid input is *not* degraded. A malformed request gets `400` and
never reaches the provider — answering it with generic messages would hide a
client bug behind a plausible-looking success.

---

## 2. Express is the primary server; Cloud Functions is an adapter

**Decision.** The application core is transport-agnostic. `bootstrap.ts` builds
it, an Express server exposes it, and a thin Cloud Functions v2 wrapper exposes
the same handler.

**Rejected.** Firebase Functions as the only entry point.

**Why.** The brief's header names Firebase but no requirement does. Making
Functions primary would force a reviewer through emulator setup before seeing
anything work; `npm run dev` and a `curl` is a better first five minutes.
Keeping the core free of both means neither choice is load-bearing.

---

## 3. One real provider, not two

**Decision.** `LlmProvider` is a port with two implementations: Gemini and a
deterministic fake. There is no second cloud provider.

**Rejected.** Shipping an OpenAI adapter alongside it to demonstrate the
abstraction.

**Why.** The abstraction is already demonstrated — the fake proves the seam is
real, and it is what makes the failure taxonomy testable. A second adapter
written against documentation and never executed is a liability: it looks like
working code, and the first person to set `LLM_PROVIDER=openai` finds out it is
not. Shipping only what was verified is the more honest signal.

---

## 4. POST, not GET

**Decision.** `POST /api/v1/suggestions` with a JSON body.

**Rejected.** `GET /api/v1/suggestions?occasion=…&relationship=…`.

**Why.** GET was genuinely tempting: the call is read-only and idempotent, and it
would make the response cacheable by any HTTP cache, right out to a CDN — a real
cost saving, achieved with no code.

It loses on where the inputs end up. `occasion` and `relationship` are
user-authored free text; in a URL they land in access logs, proxy logs, browser
history and `Referer` headers, in a way a body does not. Server-side caching
recovers most of the cost benefit without that exposure.

---

## 5. Retry only what is transient, and classify it once

**Decision.** `LlmError.kind` carries the classification and `LlmError.retryable`
derives from it. Timeout, 429, 5xx and network errors are retried with full
jitter; auth errors, content filtering and malformed output are not.

**Why.** Retrying a rejected API key cannot fix it — it only multiplies the
latency of a request that was already doomed, and delays the fallback the user
could have had immediately. A content filter refusal is deterministic; the same
prompt will be refused again, so a retry is pure cost.

Full jitter rather than plain exponential backoff: when a provider degrades,
every instance fails at once, and deterministic backoff makes them all retry at
once too. Randomising the whole interval spreads the load instead of
synchronising it.

### A status code is not enough to classify a credential failure

Verified against the live API rather than assumed. Google returns a rejected key
as **HTTP 400 `INVALID_ARGUMENT`** with `reason: API_KEY_INVALID` — not the
401/403 a status-only classifier expects.

Left unhandled, the single most likely production misconfiguration would have been
filed under `unknown` and logged at `warn`, so the `error`-level line the alerting
is built on would never have fired. The adapter now inspects the error body for
Google's credential markers before falling back to the status code, and there is a
regression test for it.

The general lesson, and the reason this is written down: the failure taxonomy is
only as good as the mapping into it, and that mapping is provider-specific
knowledge that cannot be derived from the HTTP spec.

---

## 5b. Model choice, and the reasoning-token trap

**Decision.** `gemini-flash-lite-latest` is the default, and the reasoning-budget
field is omitted from the request unless explicitly configured.

**Both halves were learned from the live API, not from documentation.**

`gemini-flash-latest` today resolves to a model that reasons. Reasoning tokens
are billed *and* drawn from the same `maxOutputTokens` budget as the answer, so a
model asked to think about three short greetings can spend the entire allowance
and return `finishReason: MAX_TOKENS` with no text at all. This adapter classifies
that as unparseable output — which is correct, and which looks nothing like the
actual cause. Every request would have degraded, for a reason no log line named.

Lite does no reasoning, is markedly cheaper and faster, and is the right size for
the task: writing a warm sentence is not a problem that benefits from a chain of
thought.

**The correction that made it worse.** The first fix sent
`thinkingConfig: { thinkingBudget: 0 }` on every request. Models that do not
reason reject that field outright with `400 INVALID_ARGUMENT`, so the fix broke
the configuration that had just been verified working. The field is now opt-in
via `GEMINI_THINKING_BUDGET`, and the regression test asserts it is **absent**
rather than merely undefined — present-with-an-undefined-value is not the same
thing to the wire.

**The general point.** A provider alias is a moving target. `-latest` means the
model behind it changes without notice, and with it the token accounting, the
latency and the failure modes. Pinning a version is the more defensible
production choice; the alias is kept here because a reviewer running this months
from now should get something that still exists.

---

## 6. A circuit breaker, not just retries

**Decision.** Five consecutive failures open the circuit for 30 seconds; while
open, requests skip the provider entirely and go straight to the fallback.

**Why.** Retries alone make an outage *worse*. Without a breaker, every request
during an outage burns the full timeout budget several times over — so the client
waits ~25 seconds to receive the same fallback it could have had in 5
milliseconds, while we keep hammering an upstream that is trying to recover and
paying for attempts that cannot succeed.

The half-open probe is what makes it self-healing: one request is admitted after
the reset window, and service resumes on its own if it succeeds.

**Note.** `/ready` stays `200` while the circuit is open. A degraded instance
still answers every request correctly; removing it from the pool would only
concentrate the same provider outage onto fewer instances.

---

## 7. Caching: in-memory here, not in production

**Decision.** An LRU + TTL cache in process, keyed by prompt version, model,
tone and the normalised occasion and relationship.

**Why it works so well here.** The input space is tiny and extremely repetitive —
a handful of occasions crossed with a handful of relationships covers most real
traffic, so hit rates are high and each hit is a generation not paid for.
Normalising the key case- and accent-insensitively means `Birthday` and
`birthday` share one entry.

**What is wrong with it.** It is per-process: with *n* instances the hit rate
falls roughly as 1/*n*, and every deploy empties it. It is used here because it
costs no infrastructure and demonstrates the decision. The `Cache` port exists so
that Redis or a Firestore collection is a change in `bootstrap.ts` and nowhere
else.

**The trade-off it creates.** Caching reduces variety — everyone asking for
`birthday + friend` within the TTL sees the same messages. Mitigated by caching
everything the model returned and serving a random subset of it. In production
the better answer is to pre-compute the popular combinations offline and treat
the LLM as the long-tail path.

**The fallback is never cached.** Doing so would extend one provider blip into an
hour of generic suggestions for that combination.


---

## 8. Prompt injection is handled in three layers, none of them sufficient alone

`occasion` and `relationship` are attacker-controlled text that ends up near a
model instruction. The defence is layered because no single layer holds:

1. **Input.** NFKC normalisation, control and zero-width characters stripped,
   50-character cap, character allowlist. This removes the cheap tricks —
   invisible text, fake role markers smuggled through newlines.
2. **Structure.** The instructions live entirely in the system role; the user
   values travel as a JSON document in the user turn and are never concatenated
   into the sentence carrying the instructions. A value is a *string field*, not
   a line of the prompt.
3. **Output.** Every generated message is re-validated: schema, length bounds, no
   URLs, no markdown. A message that was successfully steered off-task still has
   to survive this to reach a client.

Layer 3 is the one that actually holds, which is why it exists even though
structured output makes malformed replies rare.

---

## 9. Rate limiting is a cost ceiling, not a security boundary

**Decision.** Per-IP fixed window, 20 requests per minute, on the generation
endpoint only. Health checks are exempt.

**Why.** An unauthenticated endpoint that spends money on every call is the one
thing here that must not be left open — a trivial loop costs real tokens, and a
client with a retry bug does the same by accident.

**What it does not do.** An attacker with a pool of addresses walks around it.
The real boundary is authentication: a Firebase Auth uid with a per-user quota,
plus App Check to tie the endpoint to our own clients. Out of scope for this
test, but it is the same middleware slot.

`TRUST_PROXY` exists because the limit is only as trustworthy as the client IP:
trusting `X-Forwarded-For` blindly would let anyone spoof their way past it.

---

## 10. The Dart client is hand-written, not generated from the spec

**Decision.** `openapi.yaml` is the contract, and `suggestions_api.dart` is
written by hand against it.

**Rejected.** Generating the client with `openapi-generator` or
`swagger_dart_code_generator`.

**Why the rejected option is better in general.** Generation makes drift
*impossible by construction*. In an organisation with many clients against many
services that difference is decisive.

**Why not here.** For a single endpoint it costs a Java toolchain or a
`build_runner` step in CI and produces a few thousand lines of generated Dart to
scroll past. The hand-written client is 170 readable lines that also do the error
mapping a generator would not produce.

**What that costs us.** Nothing checks the two automatically. Keeping them in step
is a discipline, not a guarantee — the honest weak point of this choice, and the
first thing I would fix given a second client.

---

## 11. Errors carry codes, not sentences

**Decision.** Validation failures return a machine-readable `rule` per field
(`too_short`, `invalid_format`, …) alongside an English `message`. The Flutter app
words its own copy from `rule` and ignores `message`.

**Why.** The same principle already applied to `error.code`: a code is stable and
a sentence is not. A client that branches on prose breaks the moment someone
improves the wording, and a client that *renders* the server's prose has ceded
control of its own voice to a service that does not know its context.

Extending it to field-level detail costs one enum and buys the client the freedom
to say "Please enter Occasion." in whatever register suits it, without the server
needing to know anything about that client's voice.

---

## 12. One occasion registry, and adapters named by direction

Three coherence problems, fixed together because they were the same problem seen
from different angles: the code had grown past the shape it was first given.

**The vocabulary lived in two places.** Display labels were in one file and
resolution aliases with the curated messages in another. Adding an occasion meant editing both and remembering a
third — the app's offline defaults. A test guarded the sync, which is the weakest
kind of guarantee: it tells you afterwards.

Now one registry entry carries the key, the label, the aliases and the messages,
and **the lookup index is built from the label**. A value the picker offers
resolves in the fallback by construction. The test that guarded the sync is still
there, reframed as a property test over that invariant — it is what would fail if
the index ever stopped being derived from the label.

**`adapters/http` and `infrastructure/llm` were both adapters.** One folder for
driving adapters and another, differently named, for driven ones is a distinction
without a difference — a leftover of renaming `interfaces/` without following
through. Now `adapters/inbound/` and `adapters/outbound/` say which direction,
and `infrastructure/` is gone.

**Two thin ports became one.** `FallbackMessages` and `SuggestionOptionsSource`
were function aliases over the same data, each with one implementation, existing
largely to satisfy the layering rule. `SuggestionCatalogue` replaces both and
describes a *thing* the application depends on rather than two isolated calls.
Port count went from five to four, and the one that remains reads like a
dependency instead of an indirection.

**Worth stating plainly:** none of this changed behaviour — the suite passed
before and after. It is the kind of tidying that is cheap now and expensive once
a second developer has built on the wrong shape.

---

## 13. The provider is faked, not mocked

**Decision.** Tests substitute `FakeLlmProvider` at the composition root and run
everything else for real — the actual middleware stack, through supertest.

**Rejected.** Intercepting HTTP, or mocking the modules under test.

**Why.** The bugs worth catching in this codebase live in the wiring: middleware
order, what the error handler serialises, whether the fallback really produces a
200. A test that mocks the layer it is testing cannot see any of them.

The one exception is `geminiProvider.test.ts`, which mocks the Google SDK — there
the mapping from provider outcomes onto our taxonomy *is* the logic under test,
and the network is not.
