import type { SuggestionCatalogue } from '../../../application/ports/suggestionCatalogue.js';
import type { SuggestionOptions } from '../../../domain/suggestion.js';
import { TONES } from '../../../domain/suggestion.js';
import { sampleWithoutReplacement } from '../../../shared/randomSample.js';
import {
  findOccasion,
  messagesFor,
  offeredOccasionLabels,
  universalMessages,
} from './occasionRegistry.js';
import { registerFor, relationshipLabels } from './relationships.js';

/**
 * Hand-curated implementation of [SuggestionCatalogue], reading from
 * `occasionRegistry.ts`.
 *
 * Two properties matter more than breadth:
 *
 * 1. Every message is safe to print unseen. They are hand-written, so no
 *    generation failure, content-policy edge case or injected instruction can
 *    reach a card through this path.
 * 2. Lookup always resolves. An unknown occasion or an unusual relationship
 *    widens to a broader match, ending at a universally appropriate set — so the
 *    fallback itself can never be the thing that fails.
 */

export interface CuratedCatalogueOptions {
  /** Overridden in tests; randomised in production so an outage is not monotonous. */
  readonly pick?: (pool: readonly string[], count: number) => string[];
}

export function createCuratedCatalogue(
  options: CuratedCatalogueOptions = {},
): SuggestionCatalogue {
  const pick = options.pick ?? sampleWithoutReplacement;

  return {
    optionsFor() {
      const catalogue: SuggestionOptions = {
        occasions: offeredOccasionLabels(),
        relationships: relationshipLabels(),
        // Tones are a closed enum in the API contract, so the identifiers travel
        // and the client supplies the labels — the one piece of this response
        // that is chrome rather than content.
        tones: TONES,
      };
      return catalogue;
    },

    fallbackMessagesFor(occasion, relationship, count) {
      const entry = findOccasion(occasion);

      const pool = entry
        ? messagesFor(entry, registerFor(relationship))
        : universalMessages();

      return pick(pool, count);
    },
  };
}
