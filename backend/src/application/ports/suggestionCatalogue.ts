import type { SuggestionOptions } from '../../domain/suggestion.js';

/**
 * The curated vocabulary behind the feature: what the pickers offer, and what to
 * say when the model cannot serve a request.
 *
 * One port rather than two, because both answers come from one catalogue. They
 * were separate ports briefly, and the split was the weaker design: two thin
 * function aliases over the same data, each with a single implementation,
 * existing mostly to satisfy the layering rule. Merging them makes the port
 * describe a *thing* the application depends on rather than two isolated calls.
 *
 * A production implementation might read this from Firestore so the catalogue
 * can be edited without a deploy; the application would not notice.
 */
export interface SuggestionCatalogue {
  /**
   * Values the client offers in its pickers.
   *
   * Every occasion returned here is one [fallbackMessagesFor] resolves, so
   * choosing from the dropdown still produces an occasion-specific card during
   * an outage.
   */
  optionsFor(): SuggestionOptions;

  /**
   * Safe, pre-written messages for when the model is unavailable.
   *
   * Must always return at least one: this is the last line of defence, and it is
   * not allowed to be the thing that fails.
   */
  fallbackMessagesFor(occasion: string, relationship: string, count: number): string[];
}
