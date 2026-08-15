/**
 * Subsequence scoring, in the spirit of a fuzzy finder: every character of the
 * needle must appear in the haystack in order, and matches that are contiguous,
 * at a word boundary, or near the start score higher.
 *
 * Returns null when the needle does not appear at all, so callers can treat
 * "no match" and "weak match" differently.
 */
export function fuzzyScore(haystack: string, needle: string): number | null {
  if (needle === "") return 0;
  const target = haystack.toLowerCase();
  const query = needle.toLowerCase();

  // An exact substring is worth more than any scattered subsequence, and the
  // earlier it starts the better.
  const direct = target.indexOf(query);
  if (direct >= 0) {
    return 1000 - direct - (isBoundary(target, direct) ? 0 : 10);
  }

  let score = 0;
  let cursor = 0;
  let previous = -2;
  for (const character of query) {
    const found = target.indexOf(character, cursor);
    if (found === -1) return null;
    score += found === previous + 1 ? 8 : 2;
    if (isBoundary(target, found)) score += 4;
    previous = found;
    cursor = found + 1;
  }
  // Shorter haystacks matching the same needle are the more specific hit.
  return score - Math.floor(target.length / 40);
}

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const before = text[index - 1];
  return before === undefined || /[\s@._\-/<>(),:]/.test(before);
}
