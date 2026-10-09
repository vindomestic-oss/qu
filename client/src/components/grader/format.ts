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

const samePoints = (a: number | null, b: number | null) => a === b || (a !== null && b !== null && Math.abs(a - b) < 1e-9);

/**
 * Admins may add a text answer to the accepted answers (wish 7) once a person credited it in full
 * and the key does not cover it yet.
 */
export function offersAcceptVariant(
  viewer: { kind: 'admin' | 'grader' } | null | undefined,
  answer: { matches_reference?: boolean; grade_source: string | null; is_correct: number | null; points_awarded: number | null },
  maxPoints: number,
): boolean {
  return (
    viewer?.kind === 'admin' &&
    answer.matches_reference === false &&
    answer.grade_source === 'human' &&
    answer.is_correct === 1 &&
    samePoints(answer.points_awarded, maxPoints)
  );
}

/** The grade was given by this viewer (graded_by is 'admin:<name>' for admins). */
export function gradedByViewer(viewer: { kind: 'admin' | 'grader'; name: string } | null | undefined, answer: { graded_by: string | null }): boolean {
  return viewer?.kind === 'admin' && answer.graded_by === `admin:${viewer.name}`;
}

/** The shared grade of a group of identical answers, or how far it is graded (wish 7). */
export function groupGrade(members: { is_correct: number | null; points_awarded: number | null; grade_source: string | null }[]): {
  graded: number;
  /** Every member has the same verdict and points. */
  uniform: { is_correct: number | null; points_awarded: number } | null;
  /** Every member was credited by the reference check. */
  allRule: boolean;
} {
  const graded = members.filter((m) => m.points_awarded !== null).length;
  const first = members[0];
  const uniform =
    graded === members.length &&
    first !== undefined &&
    members.every((m) => m.is_correct === first.is_correct && samePoints(m.points_awarded, first.points_awarded))
      ? { is_correct: first.is_correct, points_awarded: first.points_awarded as number }
      : null;
  return { graded, uniform, allRule: graded === members.length && members.every((m) => m.grade_source === 'rule') };
}

/** The participant's name, or "Participant N" if the server sent none. */
export function participantLabel(
  p: { number: number; display_name?: string },
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  return p.display_name ?? t('grader.table.anonymous', { n: p.number });
}
