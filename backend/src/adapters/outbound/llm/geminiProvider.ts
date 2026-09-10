import { ApiError, FinishReason, GoogleGenAI, Type } from '@google/genai';
import type { LlmProvider } from '../../../application/ports/llmProvider.js';
import { classifyHttpStatus, LlmError } from '../../../domain/errors.js';
import type { SuggestionQuery } from '../../../domain/suggestion.js';
import { SUGGESTION_LIMITS } from '../../../domain/suggestion.js';
import { parseSuggestions } from './parseSuggestions.js';
import {
  buildUserContent,
  PROMPT_VERSION,
  STRICT_RETRY_SUFFIX,
  SYSTEM_INSTRUCTION,
} from './prompt.js';

/**
 * Google Gemini adapter.
 *
 * Responsibilities, and deliberately nothing else: turn a `SuggestionQuery` into
 * a provider call, and turn every possible provider outcome into either clean
 * strings or an `LlmError`. No SDK type and no provider error string escapes
 * this file, which is what lets the layers above reason about failures in terms
 * of the taxonomy rather than in terms of Google's API.
 */

export interface GeminiProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  /** Higher than a factual task would use: three near-identical cards are a bad answer. */
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  /**
   * Reasoning-token allowance, or `undefined` to leave the field off entirely.
   *
   * Only relevant for models that reason. Those bill reasoning tokens and draw
   * them from the same `maxOutputTokens` budget as the answer, so a model left
   * to think through three short greetings can spend the whole allowance and
   * return `MAX_TOKENS` with no text — a failure that looks nothing like its
   * cause. Setting `0` on such a model avoids both the cost and that trap.
   *
   * It must stay off for models that do not reason: they reject the field with
   * 400 INVALID_ARGUMENT. Both behaviours were observed against the live API.
   */
  readonly thinkingBudget?: number;
}

/**
 * Gemini's schema dialect is OpenAPI-flavoured, not JSON Schema: the type is an
 * enum of upper-case names and the array bounds are strings. Written out here
 * rather than translated from the neutral schema in `prompt.ts` — a five-line
 * literal is clearer than a converter, and a second adapter would have its own
 * dialect anyway.
 */
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    messages: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      minItems: String(SUGGESTION_LIMITS.minCount),
      maxItems: String(SUGGESTION_LIMITS.maxCount),
    },
  },
  required: ['messages'],
};

export class GeminiProvider implements LlmProvider {
  readonly modelId: string;
  readonly promptVersion = PROMPT_VERSION;

  private readonly client: GoogleGenAI;
  private readonly temperature: number;
  private readonly maxOutputTokens: number;
  private readonly thinkingBudget: number | undefined;

  constructor(options: GeminiProviderOptions) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
    this.modelId = options.model;
    this.temperature = options.temperature ?? 0.9;
    this.maxOutputTokens = options.maxOutputTokens ?? 512;
    this.thinkingBudget = options.thinkingBudget;
  }

  async generateMessages(query: SuggestionQuery, signal: AbortSignal): Promise<string[]> {
    const userContent = buildUserContent(query);

    const firstAttempt = await this.callModel(SYSTEM_INSTRUCTION, userContent, signal);
    try {
      return parseSuggestions(firstAttempt, SUGGESTION_LIMITS.minCount);
    } catch (error) {
      // One corrective retry, and only for a parse failure. A reply that came
      // back as prose is usually a sampling accident, so restating the format
      // requirement is cheap and often works. Every other failure kind is
      // handled by the retry policy above this layer, which knows whether the
      // fault is transient.
      if (!(error instanceof LlmError) || error.kind !== 'invalid_output') throw error;

      const secondAttempt = await this.callModel(
        SYSTEM_INSTRUCTION + STRICT_RETRY_SUFFIX,
        userContent,
        signal,
      );
      return parseSuggestions(secondAttempt, SUGGESTION_LIMITS.minCount);
    }
  }

  private async callModel(
    systemInstruction: string,
    userContent: string,
    signal: AbortSignal,
  ): Promise<string> {
    let response;
    try {
      response = await this.client.models.generateContent({
        model: this.modelId,
        contents: [{ role: 'user', parts: [{ text: userContent }] }],
        config: {
          systemInstruction,
          // Constrained decoding, so a well-formed reply is the default rather
          // than something we merely asked for. `parseSuggestions` re-checks
          // anyway: the constraint is an optimisation, not a guarantee.
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: this.temperature,
          // The answer is three short sentences. Capping output is the single
          // most effective per-request cost control available here, and it also
          // bounds the damage if the model starts rambling.
          maxOutputTokens: this.maxOutputTokens,
          // Omitted entirely unless configured: a model that does not reason
          // rejects the field outright with 400 INVALID_ARGUMENT, which is how
          // the default (lite) behaves.
          ...(this.thinkingBudget === undefined
            ? {}
            : { thinkingConfig: { thinkingBudget: this.thinkingBudget } }),
          abortSignal: signal,
        },
      });
    } catch (cause) {
      throw toLlmError(cause);
    }

    // A blocked prompt returns a 200 with no candidates, so it has to be checked
    // separately from the throw path.
    const blockReason = response.promptFeedback?.blockReason;
    if (blockReason) {
      throw new LlmError('content_filtered', `Prompt blocked by the provider (${blockReason}).`);
    }

    const text = response.text;
    if (!text) {
      const finishReason = response.candidates?.[0]?.finishReason;
      // MAX_TOKENS means the JSON was cut mid-document: a parse problem, not an
      // outage, so it earns the corrective retry rather than the backoff loop.
      // Compared against the SDK's enum rather than a bare string, so a rename
      // upstream becomes a compile error instead of a silently dead branch.
      const kind =
        finishReason === FinishReason.MAX_TOKENS ? 'invalid_output' : 'content_filtered';
      throw new LlmError(kind, `Provider returned no text (finishReason=${finishReason ?? 'none'}).`);
    }

    return text;
  }
}

/**
 * Markers Google uses for a credential problem.
 *
 * Verified against the live API rather than assumed: an invalid key comes back
 * as **HTTP 400 INVALID_ARGUMENT** with `reason: API_KEY_INVALID`, not the
 * 401/403 a status-only classifier would expect. Left unhandled, the single most
 * likely production misconfiguration would be logged as an anonymous `unknown`
 * at `warn` instead of the `error` the alerting depends on.
 *
 * Matched on the body because that is where Google puts the distinction; the
 * status code alone cannot tell a bad key from a malformed request.
 */
const CREDENTIAL_MARKERS = [
  'API_KEY_INVALID',
  'API_KEY_SERVICE_BLOCKED',
  'API key not valid',
  'PERMISSION_DENIED',
  'UNAUTHENTICATED',
  'SERVICE_DISABLED',
  'CONSUMER_INVALID',
];

function isCredentialProblem(message: string): boolean {
  const haystack = message.toUpperCase();
  return CREDENTIAL_MARKERS.some((marker) => haystack.includes(marker.toUpperCase()));
}

/** Maps anything the SDK can throw onto the failure taxonomy. */
function toLlmError(cause: unknown): LlmError {
  if (cause instanceof ApiError) {
    const kind = isCredentialProblem(cause.message)
      ? 'auth_error'
      : classifyHttpStatus(cause.status);

    // Our own wording: the provider's message carries the full error body and
    // must not travel any further than this layer.
    return new LlmError(kind, `Provider returned HTTP ${cause.status}.`, {
      status: cause.status,
      cause,
    });
  }

  // The SDK surfaces an aborted request as a DOMException; `withTimeout` will
  // relabel it if our own deadline was the cause.
  if (cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError')) {
    return new LlmError('timeout', 'Provider call was aborted.', { cause });
  }

  // Undici wraps DNS/TLS/socket problems as a TypeError with a cause.
  if (cause instanceof TypeError) {
    return new LlmError('network_error', 'Could not reach the provider.', { cause });
  }

  return new LlmError('unknown', 'Unexpected provider failure.', { cause });
}
