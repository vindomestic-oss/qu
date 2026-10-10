// Wish 8 (S15): the "difficult question" badge, as in Kahoot's reports. A question is difficult when
// fewer than 35 % of its GRADED answers are correct, counted only from 5 graded answers on (one wrong
// answer out of two says nothing). Ungraded answers (needs review, awaiting submission) and blank
// answers never count. Partial credit counts as correct when the grader marked it correct.

export const DIFFICULT_BELOW = 0.35;
export const DIFFICULT_MIN_GRADED = 5;

export function isDifficult(correct: number, graded: number): boolean {
  return graded >= DIFFICULT_MIN_GRADED && correct / graded < DIFFICULT_BELOW;
}
