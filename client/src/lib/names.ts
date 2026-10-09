/** Mirror of server/src/lib/names.ts: same normalisation, so storage keys match the server's idea of "the same name". */
export function normalizeDisplayName(raw: string): string {
  const cleaned = raw
    .normalize('NFKC')
    .replace(/[\p{Cf}\p{Cc}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return Array.from(cleaned).slice(0, 50).join('').trim();
}

export function nameKey(raw: string): string {
  return normalizeDisplayName(raw).toLowerCase();
}
