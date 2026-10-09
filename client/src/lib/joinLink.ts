// Client-side origin for join links. Not the server env var PUBLIC_BASE_URL (grader links, S12).
export const APP_ORIGIN = (import.meta.env.VITE_PUBLIC_URL || window.location.origin).replace(/\/$/, '');
export const displayHost = APP_ORIGIN.replace(/^https?:\/\//, '');

export function buildJoinUrl(code: string): string {
  return `${APP_ORIGIN}/j/${code}`;
}

// Cyrillic keys that look like Latin letters or digits of the code alphabet.
const HOMOGLYPHS: Record<string, string> = {
  А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', К: 'K', М: 'M', Р: 'P', Т: 'T', Х: 'X', У: 'Y', З: '3',
};

/** Tolerant code input: lower case, spaces, hyphens and Cyrillic look-alikes become the 6-character code. */
export function normalizeJoinCode(s: string): string {
  return s
    .toUpperCase()
    .replace(/[АВСЕНКМРТХУЗ]/g, (ch) => HOMOGLYPHS[ch])
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

/** "ABC234" → "ABC 234" for reading aloud and from far away. */
export function formatJoinCode(c: string): string {
  return c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c;
}
