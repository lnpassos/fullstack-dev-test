/**
 * Random selection without replacement.
 *
 * Shared by the fallback templates and the cache read path: both need "show a
 * different few of these each time" so that an outage, or a popular cached
 * combination, does not present every user with an identical card.
 *
 * Splice-based rather than a Fisher-Yates shuffle followed by a slice: it stops
 * as soon as it has enough, and it avoids indexing into an array whose elements
 * TypeScript cannot prove are present.
 */
export function sampleWithoutReplacement<T>(pool: readonly T[], count: number): T[] {
  const remaining = [...pool];
  const picked: T[] = [];

  while (picked.length < count && remaining.length > 0) {
    const [item] = remaining.splice(Math.floor(Math.random() * remaining.length), 1);
    if (item !== undefined) picked.push(item);
  }

  return picked;
}
