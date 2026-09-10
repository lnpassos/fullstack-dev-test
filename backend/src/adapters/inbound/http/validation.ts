import { z } from 'zod';
import type { ValidationDetail, ValidationRule } from '../../../domain/errors.js';
import type { SuggestionQuery } from '../../../domain/suggestion.js';
import { SUGGESTION_LIMITS, TONES } from '../../../domain/suggestion.js';
import { normalizeUserField } from '../../../domain/textNormalization.js';

/**
 * Request validation for `POST /api/v1/suggestions`.
 *
 * Validation here is doing two jobs at once. The obvious one is rejecting
 * malformed requests with a useful message. The less obvious one is shrinking
 * the prompt-injection surface before anything reaches the model: a field that
 * must be under 50 characters and may only contain letters, digits and a short
 * list of punctuation is a poor vehicle for smuggled instructions.
 *
 * The order matters — raw length is capped *before* normalisation, so a
 * megabyte of zero-width characters is rejected rather than normalised.
 */

/** Letters (any script), digits, spaces and the punctuation a real occasion uses. */
const ALLOWED_FIELD_CHARS = /^[\p{L}\p{N} '\-.,&!?()/]+$/u;

const userField = (label: string) =>
  z
    .string({ error: `${label} must be a string.` })
    // Guard before doing any work on the value.
    .max(200, `${label} is too long.`)
    .transform(normalizeUserField)
    .pipe(
      z
        .string()
        .min(2, `${label} must be at least 2 characters.`)
        .max(
          SUGGESTION_LIMITS.maxFieldLength,
          `${label} must be at most ${SUGGESTION_LIMITS.maxFieldLength} characters.`,
        )
        .regex(ALLOWED_FIELD_CHARS, `${label} contains unsupported characters.`),
    );

/**
 * `strictObject` rejects unknown keys instead of ignoring them. A request
 * carrying a field we do not recognise is either a client bug worth surfacing
 * early or an attempt to smuggle something past us; neither deserves a silent
 * success.
 */
export const suggestionRequestSchema = z.strictObject({
  occasion: userField('occasion'),
  relationship: userField('relationship'),
  tone: z.enum(TONES).default('warm'),
  count: z.coerce
    .number()
    .int()
    .min(SUGGESTION_LIMITS.minCount)
    .max(SUGGESTION_LIMITS.maxCount)
    .default(SUGGESTION_LIMITS.maxCount),
});

export type SuggestionRequestBody = z.infer<typeof suggestionRequestSchema>;


/** The validated body is already exactly the domain query. */
export function toSuggestionQuery(body: SuggestionRequestBody): SuggestionQuery {
  return body;
}

/**
 * Zod's issue vocabulary, folded onto ours.
 *
 * Translated rather than passed through so the public contract does not inherit
 * a validation library's taxonomy: swapping Zod out must not be a breaking API
 * change for every client that branches on these.
 */
function toRule(issue: z.core.$ZodIssue): ValidationRule {
  switch (issue.code) {
    case 'invalid_type':
      // Zod reports a missing property as the wrong type; for a client the
      // actionable distinction is "you left it out".
      return issue.input === undefined ? 'required' : 'invalid_value';
    case 'too_small':
      return 'too_short';
    case 'too_big':
      return 'too_long';
    case 'invalid_format':
      return 'invalid_format';
    case 'unrecognized_keys':
      return 'unknown_field';
    default:
      return 'invalid_value';
  }
}

/**
 * Field-level detail, safe to return: it describes our own rules, not internals.
 *
 * Each entry carries both a `rule` a client can localise and a `message` a
 * developer can read in a log.
 */
export function toValidationDetails(error: z.ZodError): ValidationDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(body)',
    rule: toRule(issue),
    message: issue.message,
  }));
}
