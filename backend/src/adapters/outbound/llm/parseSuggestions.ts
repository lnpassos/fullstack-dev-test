import { z } from 'zod';
import { LlmError } from '../../../domain/errors.js';
import { SUGGESTION_LIMITS } from '../../../domain/suggestion.js';
import { normalizeUserField } from '../../../domain/textNormalization.js';

/**
 * Turns whatever the provider actually returned into clean message strings.
 *
 * Structured-output modes make a well-formed reply the common case, but they are
 * a strong hint rather than a guarantee: models still occasionally wrap the JSON
 * in a code fence or prepend a sentence, and a provider may silently downgrade
 * the constraint. Everything here is defence in depth — and it doubles as the
 * output-side barrier against prompt injection, since a message that was
 * steered off-task still has to survive these checks to reach a client.
 */

const responseSchema = z.object({
  messages: z.array(z.string()),
});

/** Fences the model sometimes adds despite being told not to. */
const CODE_FENCE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/u;

/** Markdown emphasis and list markers that would render literally on a card. */
const MARKDOWN_NOISE = /[*_`#>]/gu;

/** A gift card message has no business containing a link. */
const URL_LIKE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|ai)\b)/iu;

/** Wrapping quotes the model adds when it "quotes" the message back. */
const WRAPPING_QUOTES = /^["'\u201C\u201D\u2018\u2019]+|["'\u201C\u201D\u2018\u2019]+$/gu;

/**
 * Extracts a JSON document from a reply that may be fenced or padded with prose.
 * Falls back to the widest `{...}` span, which is the shape the model was asked
 * for; anything outside it is discarded.
 */
function extractJsonText(raw: string): string {
  const trimmed = raw.trim();

  const fenced = CODE_FENCE.exec(trimmed);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

/**
 * Applies the presentation rules the prompt asked for. Returns `null` when the
 * candidate is unusable, so the caller can drop it and keep the rest.
 */
function sanitizeMessage(candidate: string): string | null {
  const cleaned = normalizeUserField(candidate)
    .replace(MARKDOWN_NOISE, '')
    .replace(WRAPPING_QUOTES, '')
    .trim();

  if (cleaned.length < SUGGESTION_LIMITS.minTextLength) return null;
  if (cleaned.length > SUGGESTION_LIMITS.maxTextLength) return null;
  if (URL_LIKE.test(cleaned)) return null;

  return cleaned;
}

/**
 * @throws {LlmError} of kind `invalid_output` when nothing usable survives.
 *   The caller decides whether that earns a corrective retry or a fallback.
 */
export function parseSuggestions(rawResponse: string, minCount: number): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonText(rawResponse));
  } catch (cause) {
    throw new LlmError('invalid_output', 'Provider response was not valid JSON.', { cause });
  }

  const result = responseSchema.safeParse(parsed);
  if (!result.success) {
    throw new LlmError('invalid_output', 'Provider response did not match the expected shape.', {
      cause: result.error,
    });
  }

  // Drop unusable candidates rather than failing the batch: two good messages
  // out of three is a perfectly good answer, and cheaper than a retry.
  const seen = new Set<string>();
  const messages: string[] = [];
  for (const candidate of result.data.messages) {
    const cleaned = sanitizeMessage(candidate);
    if (cleaned === null) continue;

    // Near-duplicates make the feature look broken; compare case-insensitively.
    const dedupeKey = cleaned.toLowerCase();
    if (seen.has(dedupeKey)) continue;

    seen.add(dedupeKey);
    messages.push(cleaned);
  }

  if (messages.length < minCount) {
    throw new LlmError(
      'invalid_output',
      `Provider returned ${messages.length} usable message(s), expected at least ${minCount}.`,
    );
  }

  return messages;
}
