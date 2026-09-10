/** Core domain types. Deliberately free of HTTP, Express and provider concepts. */

/**
 * Where the messages the client received actually came from.
 *
 * This is part of the public contract: the client renders a different affordance
 * for `fallback` (a "showing generic suggestions" notice) than for `llm`.
 */
export const SUGGESTION_SOURCES = ['llm', 'cache', 'fallback'] as const;
export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number];

export interface Suggestion {
  /** Stable within a response; used as a list key by the client. */
  readonly id: string;
  readonly text: string;
}

export const TONES = ['warm', 'funny', 'formal', 'heartfelt'] as const;
export type Tone = (typeof TONES)[number];

export interface SuggestionQuery {
  readonly occasion: string;
  readonly relationship: string;
  readonly tone: Tone;
  readonly count: number;
}

export interface SuggestionResult {
  readonly suggestions: readonly Suggestion[];
  readonly source: SuggestionSource;
  /** True whenever the LLM could not serve this request. */
  readonly degraded: boolean;
  /** Absent on the fallback path — there is no model behind those messages. */
  readonly model: string | undefined;
}

/** The vocabulary a client offers in its pickers. */
export interface SuggestionOptions {
  readonly occasions: readonly string[];
  readonly relationships: readonly string[];
  readonly tones: readonly string[];
}

/** Bounds shared by input validation and output sanitisation. */
export const SUGGESTION_LIMITS = {
  minCount: 2,
  maxCount: 3,
  /** A gift card message that does not fit on a gift card is not a suggestion. */
  maxTextLength: 180,
  minTextLength: 4,
  maxFieldLength: 50,
} as const;
