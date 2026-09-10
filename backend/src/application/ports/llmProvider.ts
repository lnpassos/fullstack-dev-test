import type { SuggestionQuery } from '../../domain/suggestion.js';

/**
 * The port the application depends on. Adapters (Gemini, OpenAI, Fake) live in
 * `infrastructure/llm` and are injected at the composition root.
 *
 * Contract: an adapter returns clean message strings, or throws `LlmError`.
 * It must never leak provider SDK errors, and never return an unvalidated shape.
 */
export interface LlmProvider {
  /** Identifies the model in logs and in the response metadata. */
  readonly modelId: string;

  /**
   * Version of the prompt this adapter sends.
   *
   * Part of the cache key: messages generated under different instructions are
   * a different product and must not be served from an entry made under the old
   * ones. Exposed here so the application can build that key without reaching
   * into a specific adapter.
   */
  readonly promptVersion: string;

  /**
   * @param signal Aborted by the caller when the per-request deadline expires.
   * @throws {import('../../domain/errors.js').LlmError}
   */
  generateMessages(query: SuggestionQuery, signal: AbortSignal): Promise<string[]>;
}
