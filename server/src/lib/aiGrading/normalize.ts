// Wish 7, layer A (S13): the comparison form of free-text answers. Pure functions, no imports; the
// stored text_answer is never modified and answer_norm is never shown to anyone.
//
// What normalizeForMatch ignores: Unicode composition (NFC/NFD), invisible and bidi control
// characters, every combining mark (Latin accents and umlauts, Hebrew niqqud and cantillation, the
// marks of Cyrillic ё/й/ї), letter case, apostrophes and geresh/gershayim, all other punctuation and
// symbols (hyphens and the Hebrew maqaf included: they become spaces), repeated whitespace, and one
// leading article (the/a/an/der/die/das). matchKey() also drops the spaces, so "Ein-Dor", "Ein Dor"
// and "Eindor" compare equal.
// What it deliberately keeps: letters without a canonical decomposition (ß, ł, ø, æ…), Hebrew final
// letters, digits vs. number words ("70" vs "siebzig"), transliterations and translations of names
// ("Yishmael" vs "Ishmael"), word order and any other wording. Those are equal only when the author
// lists them as accepted answers; there is no fuzzy matching (nearMatch is a hint for S14's model,
// never a grade).

/** Step 2: soft hyphen, zero-width space/joiners, LRM/RLM, bidi embeddings and isolates, word joiner, BOM. */
export const INVISIBLE_CHARS_RE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
/** Step 5: ' ` ´ ‘ ’ ʼ and the Hebrew geresh ׳ and gershayim ״ are deleted (Giv'onites = Givonites). */
const APOSTROPHES_RE = /[\u0027\u0060\u00B4\u2018\u2019\u02BC\u05F3\u05F4]/g;
const MARKS_RE = /\p{M}/gu;
const PUNCTUATION_RE = /[\p{P}\p{S}]/gu;
const LEADING_ARTICLE_RE = /^(?:the|a|an|der|die|das) (?=\S)/;

/** The comparison form of an answer or an accepted variant ('' when nothing comparable is left). */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFC')
    .replace(INVISIBLE_CHARS_RE, '')
    .normalize('NFD')
    .replace(MARKS_RE, '')
    .toLowerCase()
    .replace(APOSTROPHES_RE, '')
    .replace(PUNCTUATION_RE, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(LEADING_ARTICLE_RE, '');
}

/** What rule comparisons use: the normalized form without spaces. */
export function matchKey(norm: string): string {
  return norm.replace(/ /g, '');
}

/** Edit distance with adjacent transpositions (optimal string alignment), over code points. */
export function damerauLevenshtein(a: string, b: string): number {
  const s = [...a];
  const t = [...b];
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;
  // d[i][j] = distance between the first i chars of s and the first j chars of t.
  const d: number[][] = Array.from({ length: s.length + 1 }, (_, i) => {
    const row = new Array<number>(t.length + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= t.length; j++) d[0][j] = j;
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[s.length][t.length];
}

/**
 * The closest candidate within a small edit distance of the answer, or null: none below 5
 * characters, at most 1 edit for 5–8 characters, at most 2 from 9 on (compared as match keys).
 * Only ever a hint (S14 sends it to the model); it never grades anything.
 */
export function nearMatch(norm: string, candidates: string[]): string | null {
  const key = matchKey(norm);
  const length = [...key].length;
  if (length < 5) return null;
  const limit = length <= 8 ? 1 : 2;
  let best: { candidate: string; distance: number } | null = null;
  for (const candidate of candidates) {
    const distance = damerauLevenshtein(key, matchKey(normalizeForMatch(candidate)));
    if (distance <= limit && (!best || distance < best.distance)) best = { candidate, distance };
  }
  return best?.candidate ?? null;
}
