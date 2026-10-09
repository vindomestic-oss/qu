/** ISO-8601 UTC timestamp for new columns; compare only against a bound nowIso() parameter, never datetime('now'). */
export const nowIso = (): string => new Date().toISOString();
