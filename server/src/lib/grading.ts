interface ChoiceRow {
  id: number;
  is_correct: number;
}

export function gradeChoiceAnswer(
  choices: ChoiceRow[],
  selectedChoiceIds: number[],
  points: number,
): { isCorrect: boolean; pointsAwarded: number } {
  const correctIds = choices.filter((c) => c.is_correct).map((c) => c.id).sort((a, b) => a - b);
  const selected = [...selectedChoiceIds].sort((a, b) => a - b);
  const isCorrect = correctIds.length === selected.length && correctIds.every((id, i) => id === selected[i]);
  return { isCorrect, pointsAwarded: isCorrect ? points : 0 };
}

// SQL fragments shared by /live, the grading panel (S12) and the navigator (S8). Aliases: q = questions,
// a = answers, p = participants. Every query that uses them must also join answers on a.session_id.

/** The participant gave a real answer: non-blank text, or at least one selected choice. */
export const ANSWERED_SQL =
  "((q.type = 'text' AND trim(coalesce(a.text_answer, '')) <> '') OR (q.type <> 'text' AND coalesce(a.selected_choice_ids, '[]') <> '[]'))";
/** A text answer of a submitted participant that nobody has graded yet. */
export const NEEDS_REVIEW_SQL = `(q.type = 'text' AND ${ANSWERED_SQL} AND a.points_awarded IS NULL AND p.submitted_at IS NOT NULL)`;
/** A text answer whose participant is still answering (grading opens after submission). */
export const AWAITING_SUBMISSION_SQL = `(q.type = 'text' AND ${ANSWERED_SQL} AND a.points_awarded IS NULL AND p.submitted_at IS NULL)`;
export const CORRECT_SQL = `(${ANSWERED_SQL} AND a.points_awarded IS NOT NULL AND a.is_correct = 1)`;
export const INCORRECT_SQL = `(${ANSWERED_SQL} AND a.points_awarded IS NOT NULL AND a.is_correct = 0)`;
