# Working agreement

Conventions for this repository. Kept short on purpose: a long document is one
nobody re-reads. Anything that can be enforced by a tool is enforced by a tool —
this file covers only what is left over.

## The contract between the two halves

`backend/openapi.yaml` is the source of truth. The Flutter models mirror it; when
they disagree, the spec is right and the client is wrong. Field names that must
never drift:

| Field | Meaning |
| --- | --- |
| `suggestions[].id` / `.text` | The messages themselves |
| `meta.source` | `llm` \| `cache` \| `fallback` — where they came from |
| `meta.degraded` | `true` whenever the LLM could not serve this request |
| `meta.requestId` | Correlates a client report with a server log line |
| `error.code` | Stable machine-readable code; the client switches on this, never on `message` |
| `error.details[].rule` | Why one field was rejected. The client words its own copy from this; `message` is for developers |

Errors always use the envelope `{ error: { code, message, requestId, details? } }`.
There is no second error shape anywhere.

## Locked decisions

Recorded with their reasoning in `docs/decisions.md`. Do not relitigate these
while implementing; change them there first if they turn out wrong.

- **Gemini Flash** is the only real provider. A second one would be another
  adapter behind `LlmProvider`, not a branch in the use case.
- **Express** is the primary server; Cloud Functions is a thin wrapper over the
  same handler.
- **Riverpod** with Dart 3 sealed state in the Flutter app.
- **The fallback path answers HTTP 200**, with `meta.degraded: true`.

## Layering

Dependencies point inward. A violation is an architecture bug, not a style issue.

```
adapters/inbound/http  →  application  →  domain
                              ↑
        adapters/outbound ────┘   (implements application/ports)

shared/  — dependency-free helpers, importable by any layer, importing none
```

Both halves of `adapters/` are adapters in the same sense; the split names the
direction. Inbound drives the application (HTTP); outbound is driven by it
(Gemini, cache, catalogue, logging). There is no `infrastructure/` — having one
folder for driving adapters and another for driven ones named something else was
a distinction without a difference.

- `domain/` knows nothing about HTTP, Express, Zod schemas or any provider.
- `application/` depends on ports, never on a concrete adapter.
- The composition root (`bootstrap.ts`) is the only file that names both a port
  and its implementation.

These are enforced by `no-restricted-imports` in `eslint.config.js`, not by this
paragraph — they were violated once before they were a rule.

`shared/` earns its "importable from anywhere" status by depending on nothing
itself. The moment it imports a layer it stops being shared and becomes a hidden
coupling between the layers that use it, so that too is a lint error.

Flutter mirrors this: `presentation` → `domain` → `data`, with the API client
never reaching into widgets and widgets never parsing JSON.

## Code conventions

**Comments explain why, never what.** A comment restating the code is deleted.
A comment carrying a decision, a trade-off, or the reason a non-obvious form was
chosen earns its place. This is the single most consistent thing about this
codebase — match it.

- Names say what a thing is for, not what it is made of: `serveFallback`, not
  `handleCase3`.
- Errors are classified at the boundary they cross, never re-derived later from
  a status code.
- Every outbound call has a deadline.
- Nothing user-supplied is interpolated into an LLM instruction.
- No secret is ever logged, and no internal error text is ever serialised to a
  client.

## Definition of done

A change is not done until all five hold:

1. `npm run lint`, `npm run typecheck` and `npm test` pass in `backend/`;
   `flutter analyze` and `flutter test` pass in `flutter_app/`.
2. There is a test for the new behaviour, not only for the code around it.
3. It has actually been run — not just compiled.
4. If it changed the API, `openapi.yaml` changed in the same commit.
5. If it added an occasion, it is **one entry** in `occasionRegistry.ts` — label,
   aliases and messages together. There is no second list.

## Testing

- The provider is substituted (`FakeLlmProvider`); nothing else is mocked.
  Integration tests drive the real middleware stack through supertest.
- Time is injected, never waited on: `now()` into the breaker and the cache,
  `sleep` into the retry loop.
- Every failure kind in the taxonomy has a test proving what the client sees.
