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

/**
 * graded_by as people read it. The server stores 'admin:alex' or 'Rav K. (link #3)': the visible name
 * is "alex (admin)" (label translated) or "Rav K.", and the stored string goes into a tooltip.
 */
export function graderIdentity(gradedBy: string | null | undefined, adminLabel: string): { name: string; title: string } {
  if (!gradedBy) return { name: '', title: '' };
  if (gradedBy.startsWith('admin:')) return { name: `${gradedBy.slice(6)} (${adminLabel})`, title: gradedBy };
  const link = /^(.*) \(link #\d+\)$/.exec(gradedBy);
  return { name: link ? link[1] : gradedBy, title: gradedBy };
}

/** A share as a percentage in the interface language ("63 %", "% 63" never). */
export function formatPercent(rate: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(rate);
  } catch {
    return `${Math.round(rate * 100)} %`;
  }
}

export const AUTO_SOURCES = new Set(['auto_choice', 'auto_blank', 'rule']);

/** The participant's name, or "Participant N" if the server sent none. */
export function participantLabel(
  p: { number: number; display_name?: string },
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  return p.display_name ?? t('grader.table.anonymous', { n: p.number });
}
