import { matchKey, normalizeForMatch, stripInvisible } from './normalize';

// questions.accepted_answers (wish 7): a JSON array of accepted answers and spellings of a text
// question, for graders and the reference check only (never sent to participants).

export const ACCEPTED_MAX_ITEMS = 30;
export const ACCEPTED_MAX_CHARS = 120;

/** The stored list as strings; anything unreadable counts as no list. */
export function parseAccepted(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
  } catch {
    return [];
  }
}

/**
 * An accepted-answers list from a request: invisible and bidi characters removed, trimmed, blanks
 * and entries without anything comparable
 * (e.g. "?!") dropped, duplicates by normalizeForMatch dropped (the first spelling stays), then at
 * most 30 entries of at most 120 characters. `null` clears the list.
 */
export function cleanAccepted(v: unknown): string[] | { error: string } {
  if (v === null) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    return { error: 'accepted_answers must be an array of strings' };
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of v as string[]) {
    const item = stripInvisible(raw).trim();
    const norm = normalizeForMatch(item);
    if (norm === '' || seen.has(norm)) continue;
    if ([...item].length > ACCEPTED_MAX_CHARS) {
      return { error: `each accepted answer must be at most ${ACCEPTED_MAX_CHARS} characters` };
    }
    seen.add(norm);
    out.push(item);
  }
  if (out.length > ACCEPTED_MAX_ITEMS) return { error: `at most ${ACCEPTED_MAX_ITEMS} accepted answers` };
  return out;
}

/** The match keys of a text question's model answer and accepted answers (empty ones left out). */
export function referenceKeys(q: { reference_answer: string | null; accepted_answers: string | null }): Set<string> {
  const keys = new Set<string>();
  for (const value of [q.reference_answer ?? '', ...parseAccepted(q.accepted_answers)]) {
    const key = matchKey(normalizeForMatch(value));
    if (key !== '') keys.add(key);
  }
  return keys;
}

/** Whether a stored answer_norm matches one of the keys. A blank or empty-normalized answer never does. */
export function matchesKeys(answerNorm: string | null, keys: Set<string>): boolean {
  if (!answerNorm) return false;
  const key = matchKey(answerNorm);
  return key !== '' && keys.has(key);
}
