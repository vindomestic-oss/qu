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
