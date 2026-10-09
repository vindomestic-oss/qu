/** ISO-8601 UTC timestamp for new columns; compare only against a bound nowIso() parameter, never datetime('now'). */
export const nowIso = (): string => new Date().toISOString();

/** Parses both timestamp formats: ISO-8601, and legacy SQLite datetime('now') 'YYYY-MM-DD HH:MM:SS' (UTC). */
export function parseDbTime(value: string): number {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? Date.parse(`${value.replace(' ', 'T')}Z`) : Date.parse(value);
}
