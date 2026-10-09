import type Database from 'better-sqlite3';

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

/**
 * Points are integers and halves (decision Q-points-step): finite, at most 100, a multiple of 0.5,
 * and > 0 for a question's points (>= 0 with allowZero, for awarded points).
 */
export function isValidPoints(v: unknown, { allowZero = false }: { allowZero?: boolean } = {}): v is number {
  return (
    typeof v === 'number' &&
    Number.isFinite(v) &&
    v <= 100 &&
    (allowZero ? v >= 0 : v > 0 && roundPoints(v) > 0) &&
    Math.abs(v * 2 - Math.round(v * 2)) < 1e-9
  );
}

/** The stored form of valid points: exactly k/2, without float noise. */
export function roundPoints(v: number): number {
  return Math.round(v * 2) / 2;
}

// --- Grading writes (wish 8) ------------------------------------------------------------------
// One service for the single PUT and for bulk-grade. Takes the database as a parameter (this module
// never imports '../db'); the caller wraps it in a transaction together with anything else it writes.

type Db = Database.Database;

/** The grading fields of an answer, as the grading API returns them. */
export interface AnswerGrade {
  id: number;
  is_correct: number | null;
  points_awarded: number | null;
  graded_at: string | null;
  graded_by: string | null;
  grade_source: string | null;
  grade_version: number;
}

export const ANSWER_GRADE_COLUMNS = 'id, is_correct, points_awarded, graded_at, graded_by, grade_source, grade_version';

export interface GradeInput {
  answerId: number;
  isCorrect: boolean;
  points: number;
  /** The grade_version the grader saw; the write is refused when the answer changed since. */
  expectedVersion: number;
  /** Display string for graded_by and grade_events.actor, e.g. 'admin:alex' or 'Rav K. (link #3)'. */
  actor: string;
  linkId: number | null;
  /** Wish 7 (S14): 'ai' = the grader accepted the AI suggestion; absent = 'human'. */
  source?: 'ai' | 'human';
  /** The audit action of an accepted suggestion: 'confirm_ai' (one row, default) or 'bulk_confirm_ai'. */
  aiAction?: 'confirm_ai' | 'bulk_confirm_ai';
}

export type GradeResult =
  | { ok: true; answer: AnswerGrade }
  | { ok: false; status: 404; error: 'not_found' }
  | { ok: false; status: 400; error: 'invalid_points'; max: number }
  | { ok: false; status: 409; error: 'not_submitted' }
  | { ok: false; status: 409; error: 'conflict'; current: AnswerGrade };

/**
 * Sets a human grade on one answer of the session, with optimistic concurrency: the UPDATE only
 * applies while grade_version still equals expectedVersion, so two graders never silently overwrite
 * each other (the later one gets 409 'conflict' with the current grade and decides). Checks, in order:
 * the answer belongs to the session (404), 0 ≤ points ≤ the question's points in steps of 0.5 (400),
 * the participant has submitted (409 'not_submitted'). Writes a grade_events row ('manual').
 * Choice answers may be overridden too; is_correct comes from the request.
 *
 * AI suggestions (wish 7, S14): with source 'ai' the grade is stored as 'ai_confirmed' (action
 * 'confirm_ai', or 'bulk_confirm_ai') only when it equals a confident, unflagged "correct" suggestion
 * (full points, is_correct); anything else is a person's grade ('human'): 'override_ai' when it
 * contradicts a finished suggestion (correct but less than full points, or incorrect but points
 * above 0), else 'manual'. The event carries the suggestion's ai_run_id. The AI never writes points.
 */
export function gradeAnswer(db: Db, sessionId: number, input: GradeInput): GradeResult {
  return db.transaction((): GradeResult => {
    const row = db
      .prepare(
        `SELECT a.id, a.question_id, a.participant_id, a.points_awarded, a.is_correct, q.points AS max_points, p.submitted_at,
           a.ai_status, a.ai_verdict, a.ai_confidence, a.ai_flagged, a.ai_run_id
         FROM answers a
         JOIN questions q ON q.id = a.question_id
         JOIN participants p ON p.id = a.participant_id
         WHERE a.id = ? AND a.session_id = ?`,
      )
      .get(input.answerId, sessionId) as
      | {
          id: number;
          question_id: number;
          participant_id: number;
          points_awarded: number | null;
          is_correct: number | null;
          max_points: number;
          submitted_at: string | null;
          ai_status: string | null;
          ai_verdict: string | null;
          ai_confidence: string | null;
          ai_flagged: number;
          ai_run_id: number | null;
        }
      | undefined;
    if (!row) return { ok: false, status: 404, error: 'not_found' };
    if (!isValidPoints(input.points, { allowZero: true }) || input.points > row.max_points + 1e-9) {
      return { ok: false, status: 400, error: 'invalid_points', max: row.max_points };
    }
    if (!row.submitted_at) return { ok: false, status: 409, error: 'not_submitted' };

    const points = roundPoints(input.points);
    const now = new Date().toISOString();
    const ai = aiDecision(row, input, points);
    const changed = db
      .prepare(
        `UPDATE answers SET is_correct = ?, points_awarded = ?, graded_at = ?, graded_by = ?, graded_by_link_id = ?,
           grade_source = ?, grade_version = grade_version + 1
         WHERE id = ? AND session_id = ? AND grade_version = ?`,
      )
      .run(input.isCorrect ? 1 : 0, points, now, input.actor, input.linkId, ai.gradeSource, row.id, sessionId, input.expectedVersion)
      .changes;
    const answer = db.prepare(`SELECT ${ANSWER_GRADE_COLUMNS} FROM answers WHERE id = ?`).get(row.id) as AnswerGrade;
    if (changed === 0) return { ok: false, status: 409, error: 'conflict', current: answer };

    insertGradeEvent(db, {
      answerId: row.id,
      sessionId,
      questionId: row.question_id,
      participantId: row.participant_id,
      actor: input.actor,
      action: ai.action,
      oldPoints: row.points_awarded,
      newPoints: points,
      oldIsCorrect: row.is_correct,
      isCorrect: input.isCorrect ? 1 : 0,
      gradeSource: ai.gradeSource,
      aiRunId: ai.runId,
    });
    return { ok: true, answer };
  })();
}

/** A finished, confident, unflagged "correct" suggestion: the only kind a grader can accept as is. */
export function isConfidentCorrect(a: { ai_status: string | null; ai_verdict: string | null; ai_confidence: string | null; ai_flagged: number }) {
  return a.ai_status === 'done' && a.ai_verdict === 'correct' && a.ai_confidence === 'high' && a.ai_flagged === 0;
}

/** How a grade relates to the answer's AI suggestion (see gradeAnswer). */
function aiDecision(
  row: { max_points: number; ai_status: string | null; ai_verdict: string | null; ai_confidence: string | null; ai_flagged: number; ai_run_id: number | null },
  input: GradeInput,
  points: number,
): { gradeSource: 'human' | 'ai_confirmed'; action: GradeEventAction; runId: number | null } {
  const suggested = row.ai_status === 'done';
  const runId = suggested ? row.ai_run_id : null;
  const full = Math.abs(points - row.max_points) < 1e-9;
  if (input.source === 'ai' && isConfidentCorrect(row) && input.isCorrect && full) {
    return { gradeSource: 'ai_confirmed', action: input.aiAction ?? 'confirm_ai', runId };
  }
  const contradicts = suggested && ((row.ai_verdict === 'correct' && points < row.max_points - 1e-9) || (row.ai_verdict === 'incorrect' && points > 0));
  return { gradeSource: 'human', action: contradicts ? 'override_ai' : 'manual', runId };
}

export type GradeEventAction =
  | 'manual'
  | 'regrade_points'
  | 'rule_match'
  | 'rule_revert'
  | 'accept_variant'
  | 'confirm_ai'
  | 'bulk_confirm_ai'
  | 'override_ai';

export interface GradeEventInput {
  answerId: number;
  sessionId: number;
  questionId: number;
  participantId: number;
  actor: string | null;
  /** 'manual' (a grader), 'regrade_points' (question points or key changed), 'rule_match' /
   *  'rule_revert' (the reference check, wish 7), 'accept_variant' (an admin added the answer to
   *  the accepted answers; the grade itself is unchanged). */
  action: GradeEventAction;
  oldPoints: number | null;
  newPoints: number | null;
  oldIsCorrect: number | null;
  isCorrect: number | null;
  gradeSource: string | null;
  /** Wish 7 (S14): the AI suggestion the answer had when it was graded ('confirm_ai',
   *  'bulk_confirm_ai', 'override_ai', or 'manual' with a suggestion present). */
  aiRunId?: number | null;
}

/** One row of the append-only audit; call it in the transaction of the change it records. */
export function insertGradeEvent(db: Db, e: GradeEventInput): void {
  db.prepare(
    `INSERT INTO grade_events (answer_id, session_id, question_id, participant_id, actor, action, old_points, new_points,
       old_is_correct, is_correct, grade_source, ai_run_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    e.answerId,
    e.sessionId,
    e.questionId,
    e.participantId,
    e.actor,
    e.action,
    e.oldPoints,
    e.newPoints,
    e.oldIsCorrect,
    e.isCorrect,
    e.gradeSource,
    e.aiRunId ?? null,
    new Date().toISOString(),
  );
}

/** Participant status on the grading panel (wish 8). */
export type ParticipantGradingStatus = 'not_started' | 'answering' | 'needs_review' | 'graded';

export function participantStatus(p: { submitted_at: string | null; answered_count: number; needs_review_count: number }): ParticipantGradingStatus {
  if (!p.submitted_at) return p.answered_count === 0 ? 'not_started' : 'answering';
  return p.needs_review_count > 0 ? 'needs_review' : 'graded';
}
