// Accepted answers of text questions (wish 7). normalizeForMatch is the same comparison form as the
// server's lib/aiGrading/normalize.ts, used only to show authors and graders what the server will
// treat as the same answer (duplicate chips, the "also accepted" list). The server decides every
// grade; keep the two copies in step.

export const ACCEPTED_MAX_ITEMS = 30;
export const ACCEPTED_MAX_CHARS = 120;

const INVISIBLE_CHARS_RE = /[\u00AD\u061C\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2069\u3164\uFEFF\uFFA0\u{E0000}-\u{E007F}]/gu;
const APOSTROPHES_RE = /[\u0027\u0060\u00B4\u2018\u2019\u02BC\u05F3\u05F4]/g;

/** Case, accents, niqqud, punctuation, spaces and one leading article (the/a/an/der/die/das) ignored. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFC')
    .replace(INVISIBLE_CHARS_RE, '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(APOSTROPHES_RE, '')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^(?:the|a|an|der|die|das) (?=\S)/, '');
}

/** What the reference check compares: the normalized form without spaces, except between two digits
 *  ("Ein-Dor" = "Eindor", but "7.0" ≠ "70"). */
export function matchKey(s: string): string {
  return normalizeForMatch(s).replace(/ (?!\d)|(?<!\d) /g, '');
}

/** The text without invisible and bidi control characters. */
export function stripInvisible(s: string): string {
  return s.replace(INVISIBLE_CHARS_RE, '');
}

/** questions.accepted_answers as stored (a JSON array) → strings; anything unreadable → []. */
export function parseAccepted(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
  } catch {
    return [];
  }
}

/**
 * The list with `draft` added, or why it cannot be added. Mirrors the server's rules: blank or
 * nothing comparable, a duplicate by normalized form, at most 30 entries.
 */
export function withDraft(list: string[], draft: string): { list: string[]; error?: string } {
  const item = stripInvisible(draft).trim();
  if (!item) return { list };
  const norm = normalizeForMatch(item);
  if (!norm) return { list, error: 'There is nothing to compare in this text (only punctuation or symbols).' };
  if (list.some((x) => normalizeForMatch(x) === norm)) {
    return { list, error: `"${item}" is already in the list (case, accents and punctuation are ignored).` };
  }
  if (list.length >= ACCEPTED_MAX_ITEMS) return { list, error: `At most ${ACCEPTED_MAX_ITEMS} accepted answers.` };
  return { list: [...list, item] };
}
