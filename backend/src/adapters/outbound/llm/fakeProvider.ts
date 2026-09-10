import type { LlmProvider } from '../../../application/ports/llmProvider.js';
import type { LlmFailureKind } from '../../../domain/errors.js';
import { LlmError } from '../../../domain/errors.js';
import type { SuggestionQuery } from '../../../domain/suggestion.js';

/**
 * Deterministic in-process provider. Never performs network I/O.
 *
 * It serves two purposes:
 *
 * - Tests drive it to reproduce every branch of the failure taxonomy on demand,
 *   which is what makes the fallback path testable without mocking a network
 *   stack or spending tokens.
 * - `LLM_PROVIDER=fake` lets the whole app be run and demoed offline, with no
 *   API key, which is also how CI exercises the HTTP layer.
 */

/** Receives the attempt number (1-based) so tests can fail once, then succeed. */
export type FakeBehaviour = (query: SuggestionQuery, attempt: number) => string[] | Promise<string[]>;

export class FakeLlmProvider implements LlmProvider {
  readonly modelId: string;
  readonly promptVersion = 'fake-v1';
  /** Number of times the provider was invoked; asserted on by retry tests. */
  callCount = 0;

  private readonly behaviour: FakeBehaviour;

  constructor(behaviour: FakeBehaviour = defaultBehaviour, modelId = 'fake-model-v1') {
    this.behaviour = behaviour;
    this.modelId = modelId;
  }

  async generateMessages(query: SuggestionQuery, signal: AbortSignal): Promise<string[]> {
    this.callCount += 1;

    // Honour the deadline like a real adapter would, so `withTimeout` behaves
    // identically against the fake.
    if (signal.aborted) {
      throw new LlmError('timeout', 'Aborted before the fake provider ran.');
    }

    return this.behaviour(query, this.callCount);
  }
}

/** Plausible, obviously-fake output for offline runs. */
function defaultBehaviour(query: SuggestionQuery): string[] {
  const { occasion, relationship } = query;
  return [
    `Wishing you a wonderful ${occasion}. (sample message for a ${relationship})`,
    `Thinking of you this ${occasion} — hope it is a great one.`,
    `Here is to a ${occasion} worth remembering.`,
  ].slice(0, query.count);
}

/** Fails every call with the given kind. Used by the fallback tests. */
export function failingProvider(kind: LlmFailureKind, status?: number): FakeLlmProvider {
  return new FakeLlmProvider(() => {
    throw new LlmError(kind, `Simulated ${kind} failure.`, status === undefined ? {} : { status });
  });
}

