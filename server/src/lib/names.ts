/**
 * Display names as children type them: Unicode-normalised (NFKC), without invisible format or control
 * characters, inner whitespace collapsed, at most 50 characters. Mirrored in client/src/lib/names.ts.
 */
export function normalizeDisplayName(raw: string): string {
  const cleaned = raw
    .normalize('NFKC')
    .replace(/[\p{Cf}\p{Cc}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return Array.from(cleaned).slice(0, 50).join('').trim();
}

/** Two names that differ only in case, spacing or invisible characters are the same name. */
export function nameKey(raw: string): string {
  return normalizeDisplayName(raw).toLowerCase();
}
