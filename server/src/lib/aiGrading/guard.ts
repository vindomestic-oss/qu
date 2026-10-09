import { normalizeForMatch } from './normalize';
import type { GradeResult } from './types';

// Wish 7, layer B (S14): the output guard against prompt injection. Besides the model's own
// injection_suspected, a keyword check on the answer (EN, DE, RU, HE) and on the rationale flags an
// answer. Flagged answers get "⚠ Suspicious answer — check manually": no Accept, never in "accept all
// confident-correct", never a precedent. A false positive only costs a manual check.
//
// Reviewed non-flags (kept as tests in aiGrading.test.ts): "I don't know", "не знаю", "Ich weiß es
// nicht", Hebrew "I don't know" and biblical answers such as "Golyat to David" are not flagged.
// The Hebrew alternatives (written as escapes) mean "ignore", "instructions" and "full marks".

export const ANSWER_GUARD_RE =
  /(ignore|disregard|instruction|system prompt|grader|full (credit|points|marks)|give me|ignorier|anweisung|volle punkt|bewerter|игнорир|инструкц|полный балл|проверяющ|\u05D4\u05EA\u05E2\u05DC\u05DD|\u05D4\u05D5\u05E8\u05D0\u05D5\u05EA|\u05E0\u05D9\u05E7\u05D5\u05D3 \u05DE\u05DC\u05D0)/i;

export const RATIONALE_GUARD_RE = /(updated instruction|as instructed|following (the|your) instruction|as requested)/i;

/**
 * S14 addition to the specified list: an answer that carries its own grading ("Score: full",
 * "Punkte: 1", "\"verdict\": \"correct\"", "SYSTEM:", "'Moshe' -> correct", Hebrew "grade:").
 * A real answer to a Bible question has no such field, so this costs no false positives and does
 * not rely on the model.
 */
export const EXAMPLE_GRADING_RE =
  /((score|grade|points?|punkte?|punktzahl|bewertung|балл\S*|оценк\S*|\u05E6\u05D9\u05D5\u05DF|verdict|confidence|system)\s*["'»“]?\s*[:=]|(->|=>|→)\s*["'»“]?\s*(correct|richtig|korrekt|верно|правильно|\u05E0\u05DB\u05D5\u05DF))/i;

/**
 * The answer itself looks like an attempt to steer the grader. Checked on the text as typed and on
 * its normalized form, so "full-points" or "sys\u200Btem prompt" do not slip through, and all
 * answers grouped under one normalized form get the same result.
 */
export function answerLooksLikeInjection(studentAnswer: string): boolean {
  return (
    ANSWER_GUARD_RE.test(studentAnswer) || ANSWER_GUARD_RE.test(normalizeForMatch(studentAnswer)) || EXAMPLE_GRADING_RE.test(studentAnswer)
  );
}

/** Whether a suggestion is flagged, and whether the keyword check (not the model) caused it. */
export function guard(studentAnswer: string, result: GradeResult): { flagged: boolean; guardHit: boolean } {
  const guardHit = answerLooksLikeInjection(studentAnswer) || RATIONALE_GUARD_RE.test(result.rationale);
  return { flagged: guardHit || result.injection_suspected, guardHit };
}
