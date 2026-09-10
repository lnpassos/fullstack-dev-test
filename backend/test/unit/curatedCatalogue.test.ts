import { describe, expect, it } from 'vitest';
import { SUGGESTION_LIMITS } from '../../src/domain/suggestion.js';
import { createCuratedCatalogue } from '../../src/adapters/outbound/catalogue/curatedCatalogue.js';

/**
 * The curated catalogue served when the model is unavailable. Two properties are
 * non-negotiable: lookup always resolves, and every message is safe to print.
 */
describe('curated catalogue', () => {
  const firstN = (pool: readonly string[], n: number): string[] => [...pool].slice(0, n);
  const catalogue = createCuratedCatalogue({ pick: firstN });
  /** Thin aliases so the assertions below read as prose. */
  const fallback = (occasion: string, relationship: string, count = 3): string[] =>
    catalogue.fallbackMessagesFor(occasion, relationship, count);

  it('returns the requested number of messages', () => {
    expect(fallback('Birthday', 'Friend', 3)).toHaveLength(3);
    expect(fallback('Birthday', 'Friend', 2)).toHaveLength(2);
  });

  it('picks a register appropriate to the relationship', () => {
    const forPartner = fallback('Birthday', 'wife', 3);
    const forManager = fallback('Birthday', 'manager', 3);
    expect(forPartner).not.toEqual(forManager);
  });

  it('groups relationships by register rather than exact wording', () => {
    expect(fallback('Birthday', 'my line manager', 3)).toEqual(
      fallback('Birthday', 'boss', 3),
    );
  });

  it('resolves synonyms onto one canonical occasion', () => {
    expect(fallback('xmas', 'friend', 3)).toEqual(
      fallback('Holidays', 'friend', 3),
    );
  });

  it('falls back to the occasion default for an unmapped relationship', () => {
    expect(fallback('Graduation', 'landlord', 3)).toHaveLength(3);
  });

  /** The fallback is the last line of defence: it must never be the failure. */
  it('always resolves, even for a completely unknown occasion', () => {
    const messages = fallback('zqx unknown celebration', 'zqx', 3);
    expect(messages).toHaveLength(3);
    for (const message of messages) {
      expect(message.length).toBeGreaterThanOrEqual(SUGGESTION_LIMITS.minTextLength);
      expect(message.length).toBeLessThanOrEqual(SUGGESTION_LIMITS.maxTextLength);
    }
  });


  /**
   * The pickers fill a free-text field verbatim, so every value the API offers
   * has to be one this catalogue recognises.
   *
   * This used to guard a manual sync between two files and was the reason the
   * missing Portuguese aliases were caught. The registry now makes it
   * structural — the lookup index is built from the same labels the picker
   * offers — so this is a property test over that invariant rather than a
   * tripwire. Worth keeping: it is what would fail if the index ever stopped
   * being derived from the labels.
   *
   * Deterministic picker on purpose: the random sampler makes an equality check
   * meaningless, and an earlier version of this test passed against a
   * deliberately broken catalogue for exactly that reason.
   */
  it('resolves every occasion the API offers', () => {
    const universal = fallback('zqx unknown celebration', 'zqx');

    for (const occasion of catalogue.optionsFor().occasions) {
      expect(
        fallback(occasion, 'Friend'),
        `"${occasion}" falls through to the universal set`,
      ).not.toEqual(universal);
    }
  });

  it('keeps every curated message within the card length budget', () => {
    const occasions = ['Birthday', 'Wedding', 'Anniversary', 'Thank you', 'Congratulations',
      'Graduation', 'Holidays', 'New baby', 'Get well', 'Sympathy', 'Retirement',
      'Farewell', 'Housewarming', 'Valentine', 'unknown'];
    const relationships = ['friend', 'colleague', 'wife', 'mother', 'landlord'];

    for (const occasion of occasions) {
      for (const relationship of relationships) {
        for (const message of fallback(occasion, relationship, 3)) {
          expect(message.length).toBeLessThanOrEqual(SUGGESTION_LIMITS.maxTextLength);
        }
      }
    }
  });
});
