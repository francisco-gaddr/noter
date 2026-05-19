/**
 * Pure search-highlight tokeniser.
 *
 * Given `text` and one or more search `terms`, returns an array of
 * `{ text, match }` segments. Callers render them with a Text run
 * (matched runs in bold/highlighted style).
 *
 * Properties:
 *   - Case-insensitive (term + text both lowered for comparison).
 *   - Locale-aware via Intl.Collator base-sensitivity? — not used here
 *     because RN's Hermes lacks consistent Intl coverage; we lowercase
 *     instead, which handles the 95% case (Latin + Cyrillic etc.).
 *   - Regex-safe: every term is escaped before matching, so a user
 *     searching for "x.y" matches the literal substring.
 *   - Overlap-safe: when terms share a prefix ("foo", "foobar"), the
 *     longest match wins.
 *   - Truncate-safe: max term length 256, max term count 16, max input
 *     length 50000 chars. Anything past these caps falls back to a
 *     single non-matched segment.
 */

export interface HighlightSegment {
  text: string;
  match: boolean;
}

const MAX_TERM_LEN = 256;
const MAX_TERMS = 16;
const MAX_INPUT_LEN = 50_000;

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cleanTerms = (terms: readonly string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_TERM_LEN) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(trimmed);
    if (out.length >= MAX_TERMS) break;
  }
  // Sort by length desc so longest-match-wins when ranges overlap.
  return out.sort((a, b) => b.length - a.length);
};

export const highlightMatches = (text: string, terms: readonly string[]): HighlightSegment[] => {
  if (typeof text !== 'string' || text.length === 0) return [];
  if (text.length > MAX_INPUT_LEN) return [{ text, match: false }];
  const cleaned = cleanTerms(terms);
  if (cleaned.length === 0) return [{ text, match: false }];

  const lowerText = text.toLowerCase();
  const ranges: Array<[number, number]> = []; // [startInclusive, endExclusive]

  for (const term of cleaned) {
    const needle = term.toLowerCase();
    let from = 0;
    while (from <= lowerText.length - needle.length) {
      const idx = lowerText.indexOf(needle, from);
      if (idx < 0) break;
      ranges.push([idx, idx + needle.length]);
      from = idx + needle.length;
    }
  }

  if (ranges.length === 0) return [{ text, match: false }];

  // Merge overlapping ranges (sort by start; coalesce).
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }

  // Walk the merged ranges and emit alternating non-match/match segments.
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor) segments.push({ text: text.slice(cursor, s), match: false });
    segments.push({ text: text.slice(s, e), match: true });
    cursor = e;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
};

export const _escapeRegex = escapeRegex;
export const _cleanTerms = cleanTerms;
