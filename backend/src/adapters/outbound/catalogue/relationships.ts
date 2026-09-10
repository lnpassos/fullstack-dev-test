import { normalizeForKey } from '../../../domain/textNormalization.js';
import type { Register } from './occasionRegistry.js';

/**
 * Relationships, bucketed by register rather than enumerated.
 *
 * Register is what changes the writing: you do not write to a manager the way
 * you write to a partner. The exact word does not matter, which is what keeps
 * the curated catalogue small enough to stay hand-written while still covering
 * the free text the API accepts.
 */

/**
 * Matched on word boundaries, not as substrings.
 *
 * `includes` would file "person" under family, because it contains "son". The
 * register would then be subtly wrong for a reason nobody would think to look
 * for.
 */
const PATTERNS: readonly (readonly [Register, RegExp])[] = [
  [
    'professional',
    /\b(colleague|coworker|co-worker|boss|manager|client|customer|teacher|professor|mentor|team|employee)\b/u,
  ],
  [
    'romantic',
    /\b(wife|husband|girlfriend|boyfriend|partner|spouse|fiance|fiancee)\b/u,
  ],
  [
    'family',
    /\b(mother|mom|mum|father|dad|parent|sister|brother|sibling|daughter|son|child|grandmother|grandma|grandfather|grandpa|aunt|uncle|cousin|niece|nephew|family|in-law)\b/u,
  ],
  ['friend', /\b(friend|buddy|mate|roommate|neighbour|neighbor)\b/u],
];

export function registerFor(relationship: string): Register {
  const key = normalizeForKey(relationship);
  for (const [register, pattern] of PATTERNS) {
    if (pattern.test(key)) return register;
  }
  return 'default';
}

/**
 * Labels for the picker.
 *
 * Unlike occasions, these need no lookup index: a relationship is never resolved
 * back to a canonical key, only bucketed by [registerFor].
 */
const LABELS: readonly string[] = [
  'Friend',
  'Colleague',
  'Manager',
  'Client',
  'Partner',
  'Mother',
  'Father',
  'Sister',
  'Brother',
  'Daughter',
  'Son',
  'Grandparent',
  'Teacher',
];

export function relationshipLabels(): readonly string[] {
  return LABELS;
}
