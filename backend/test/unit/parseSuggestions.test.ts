import { describe, expect, it } from 'vitest';
import { LlmError } from '../../src/domain/errors.js';
import { SUGGESTION_LIMITS } from '../../src/domain/suggestion.js';
import { parseSuggestions } from '../../src/adapters/outbound/llm/parseSuggestions.js';

/**
 * These cases are the reason the parser exists. Structured output makes a clean
 * reply the common case, but "common" is not "guaranteed", and the difference
 * between the two is whether a malformed generation reaches a customer's card.
 */
describe('parseSuggestions', () => {
  const MIN = SUGGESTION_LIMITS.minCount;

  it('parses a well-formed reply', () => {
    const raw = JSON.stringify({ messages: ['Happy birthday!', 'Have a great day.'] });
    expect(parseSuggestions(raw, MIN)).toEqual(['Happy birthday!', 'Have a great day.']);
  });

  it('unwraps a markdown code fence', () => {
    const raw = '```json\n{"messages":["Happy birthday!","Have a great day."]}\n```';
    expect(parseSuggestions(raw, MIN)).toHaveLength(2);
  });

  it('extracts the JSON from surrounding prose', () => {
    const raw = 'Sure! Here you go:\n{"messages":["Happy birthday!","Have a great day."]}\nHope that helps.';
    expect(parseSuggestions(raw, MIN)).toHaveLength(2);
  });

  it('strips markdown emphasis and wrapping quotes', () => {
    const raw = JSON.stringify({ messages: ['**Happy birthday!**', '"Have a great day."'] });
    expect(parseSuggestions(raw, MIN)).toEqual(['Happy birthday!', 'Have a great day.']);
  });

  it('drops a message containing a link', () => {
    const raw = JSON.stringify({
      messages: ['Happy birthday!', 'Claim it at https://evil.example', 'Have a great day.'],
    });
    expect(parseSuggestions(raw, MIN)).toEqual(['Happy birthday!', 'Have a great day.']);
  });

  it('drops a message that would not fit on a card', () => {
    const raw = JSON.stringify({
      messages: ['Happy birthday!', 'x'.repeat(SUGGESTION_LIMITS.maxTextLength + 1), 'Have a great day.'],
    });
    expect(parseSuggestions(raw, MIN)).toHaveLength(2);
  });

  it('drops near-duplicates that differ only in case', () => {
    const raw = JSON.stringify({
      messages: ['Happy birthday!', 'HAPPY BIRTHDAY!', 'Have a great day.'],
    });
    expect(parseSuggestions(raw, MIN)).toHaveLength(2);
  });

  it('rejects a reply that is not JSON at all', () => {
    expect(() => parseSuggestions('I am afraid I cannot help with that.', MIN)).toThrow(LlmError);
  });

  it('rejects a reply with the wrong shape', () => {
    expect(() => parseSuggestions(JSON.stringify({ suggestions: ['a', 'b'] }), MIN)).toThrow(
      LlmError,
    );
  });

  it('classifies every failure as invalid_output so it earns a corrective retry', () => {
    try {
      parseSuggestions('not json', MIN);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(LlmError);
      expect((error as LlmError).kind).toBe('invalid_output');
      // A malformed reply is not a transient fault: the backoff loop must not
      // treat it as one.
      expect((error as LlmError).retryable).toBe(false);
    }
  });

  it('rejects when too few messages survive sanitisation', () => {
    const raw = JSON.stringify({ messages: ['Happy birthday!', 'see http://spam.example'] });
    expect(() => parseSuggestions(raw, MIN)).toThrow(/at least/i);
  });
});
