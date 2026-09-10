/**
 * Normalisation for free-text fields that end up inside an LLM prompt.
 *
 * `occasion` and `relationship` are attacker-controlled. Normalising them is the
 * first of three layers against prompt injection; the other two are structural
 * (the fields travel as JSON data, never concatenated into the instructions —
 * see `prompt.ts`) and output-side (every generated message is re-validated
 * against a schema and length bounds — see `parseSuggestions.ts`).
 *
 * No single layer is sufficient on its own. Normalisation in particular is not
 * a security boundary: it removes the cheap tricks (invisible characters, fake
 * role markers smuggled through newlines) so that the structural and output
 * layers face a smaller problem.
 */

/** C0/C1 control characters, minus nothing — newlines included, on purpose. */
// eslint-disable-next-line no-control-regex -- matching control characters is the entire purpose
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/gu;

/**
 * Zero-width and bidirectional formatting characters. These render as nothing
 * but survive into the prompt, which makes them a classic way to hide
 * instructions inside an innocuous-looking value.
 */
const INVISIBLE_CHARS = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/gu;

const WHITESPACE_RUN = /\s+/gu;

/**
 * Canonicalise, strip anything invisible, and collapse whitespace.
 *
 * NFKC first, so that compatibility forms (fullwidth latin, for example) fold
 * onto their ASCII equivalents before the other filters run — otherwise a
 * filter could be bypassed with a lookalike codepoint.
 */
export function normalizeUserField(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(CONTROL_CHARS, ' ')
    .replace(INVISIBLE_CHARS, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
}

/**
 * Cache-key normalisation: case- and accent-insensitive.
 *
 * "Birthday", "birthday" and "BIRTHDAY " are the same request as far as cost is
 * concerned, and collapsing them multiplies the hit rate. Applied only to the
 * key — the model still receives the user's original spelling.
 */
export function normalizeForKey(value: string): string {
  return normalizeUserField(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}
