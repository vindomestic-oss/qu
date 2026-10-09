// Shared formatting for the grading panel (wish 8).

/** Points with the locale's decimal separator: 27.5 → "27,5" in German and Russian. */
export function formatPoints(n: number | null | undefined, locale: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);
  } catch {
    return String(Math.round(n * 10) / 10);
  }
}

/** graded_by as people read it: 'admin:alex' → 'alex (admin)'; graders are stored as 'Name (link #3)'. */
export function graderDisplayName(gradedBy: string | null | undefined): string {
  if (!gradedBy) return '';
  return gradedBy.startsWith('admin:') ? `${gradedBy.slice(6)} (admin)` : gradedBy;
}

export const AUTO_SOURCES = new Set(['auto_choice', 'auto_blank', 'rule']);

/** The participant's name, or "Participant N" if the server sent none. */
export function participantLabel(
  p: { number: number; display_name?: string },
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  return p.display_name ?? t('grader.table.anonymous', { n: p.number });
}
