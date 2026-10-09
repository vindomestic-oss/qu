import type { AiSuggestionFields, GradingAnswer } from '../../types';

// Wish 7, layer B (S14): rules of the AI suggestions shared by the grading panel's components.

export type AiAnswer = Partial<AiSuggestionFields> & Pick<GradingAnswer, 'points_awarded' | 'grade_source'>;

/** A finished, confident, unflagged "correct" suggestion on an ungraded answer: the only kind with Accept. */
export function isAiAcceptable(a: AiAnswer): boolean {
  return (
    a.points_awarded === null &&
    a.ai_status === 'done' &&
    a.ai_verdict === 'correct' &&
    a.ai_confidence === 'high' &&
    !a.ai_flagged
  );
}

/** The member of a group of identical answers whose suggestion stands for the group. */
export function groupSuggestion<T extends AiAnswer>(members: T[]): T {
  return members.find((m) => m.ai_status === 'done') ?? members.find((m) => m.ai_status) ?? members[0];
}

