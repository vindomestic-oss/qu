/**
 * Server timestamps come in two formats: ISO-8601 (new columns) and legacy SQLite
 * 'YYYY-MM-DD HH:MM:SS', which is UTC without a zone. Both become the right instant, so times show
 * in the device's time zone without a 1–2 hour shift.
 */
export function parseServerDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "14:32" today, otherwise "9 Oct, 14:32", in the device time zone and the given locale. */
export function formatServerTime(value: string | null | undefined, locale: string): string {
  const d = parseServerDate(value);
  if (!d) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  try {
    return sameDay
      ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return d.toLocaleString();
  }
}
