import type { ParticipantQuestion, QuizSection } from '../types';

export interface NavGroup {
  key: string;
  section: QuizSection | null;
  /** 0 = no rubric (no band); 1..6 = --section-1..6 by the rubric's position, modulo 6. */
  colorIndex: number;
  startIndex: number;
  endIndex: number;
}

/**
 * Contiguous runs of questions with the same rubric, in question order. A rubric interrupted by
 * another one shows as two runs with the same label and colour. Without rubrics: one unlabelled run.
 */
export function buildNavGroups(questions: ParticipantQuestion[], sections: QuizSection[]): NavGroup[] {
  const ordered = [...sections].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const byId = new Map(ordered.map((s, i) => [s.id, { section: s, colorIndex: (i % 6) + 1 }]));
  const groups: NavGroup[] = [];
  questions.forEach((q, i) => {
    const meta = q.section_id != null ? byId.get(q.section_id) : undefined;
    const sectionId = meta ? meta.section.id : null;
    const last = groups[groups.length - 1];
    if (last && (last.section?.id ?? null) === sectionId) {
      last.endIndex = i;
      return;
    }
    groups.push({
      key: `${sectionId ?? 'none'}-${i}`,
      section: meta?.section ?? null,
      colorIndex: meta?.colorIndex ?? 0,
      startIndex: i,
      endIndex: i,
    });
  });
  return groups;
}
