import type Database from 'better-sqlite3';
import { aiConfig } from './config';
import { answerLooksLikeInjection } from './guard';
import { hasReference } from './prompt';
import { TEXT_ANSWER_MAX_CHARS_AI } from './types';

// Wish 7, layer B (S14): which answers wait for an AI suggestion. Runs after the reference check
// (S13, process.ts), so answers it credited are never sent. Functions take the database as a
// parameter and never import lib/sessions; the caller kicks the worker and notifies the staff room.
//
// An answer is queued only when ALL hold: model calls are enabled (config.ts: AI_GRADING_ENABLED,
// a configured provider, kill switch released), its quiz has ai_grading_enabled = 1, it is a
// non-blank text answer without points, and its participant has submitted. With any of these off
// nothing is queued and no provider call can happen. A question without a model answer or accepted
// answers is 'skipped' ('no_reference'); an answer longer than 300 characters (saved before the
// quiz had AI suggestions) is 'skipped' ('too_long') and never sent; an answer that people graded
// the same way in every earlier run is 'skipped' ('precedent'), unless it looks like an injection
// attempt. Answers submitted while calls were off are not queued later by themselves: the session
// end or an admin's "Run AI pre-check" picks them up.

type Db = Database.Database;

export interface QueueOutcome {
  queued: number[];
  skipped: number[];
  /** Changed answer ids per session, for grading:changed. */
  bySession: Map<number, number[]>;
}

interface Candidate {
  id: number;
  session_id: number;
  question_id: number;
  answer_norm: string;
  text_answer: string;
  reference_answer: string | null;
  accepted_answers: string | null;
}

const RESET_SUGGESTION = `ai_source = NULL, ai_verdict = NULL, ai_confidence = NULL, ai_rationale = NULL, ai_flagged = 0,
  ai_run_id = NULL, ai_claim = NULL`;

/** Precedent: people gave this answer the same points in every earlier run (at least once). */
function unanimousPrecedent(db: Db, c: Candidate): boolean {
  const r = db
    .prepare(
      `SELECT COUNT(DISTINCT points_awarded) AS k, COUNT(*) AS n FROM answers
       WHERE question_id = ? AND answer_norm = ? AND session_id <> ? AND grade_source IN ('human', 'ai_confirmed')
         AND points_awarded IS NOT NULL`,
    )
    .get(c.question_id, c.answer_norm, c.session_id) as { k: number; n: number };
  return r.n > 0 && r.k === 1;
}

/**
 * Queues the eligible answers selected by `where` (aliases a = answers, q = questions), in one
 * transaction. Touches only rows without a suggestion state, or failed ones with includeFailed.
 */
export function queueAnswers(db: Db, where: string, params: unknown[], opts: { includeFailed?: boolean } = {}): QueueOutcome {
  const out: QueueOutcome = { queued: [], skipped: [], bySession: new Map() };
  if (!aiConfig(db).modelCallsEnabled) return out;
  const states = opts.includeFailed ? "(a.ai_status IS NULL OR a.ai_status = 'failed')" : 'a.ai_status IS NULL';
  return db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT a.id, a.session_id, a.question_id, a.answer_norm, a.text_answer, q.reference_answer, q.accepted_answers
         FROM answers a
         JOIN questions q ON q.id = a.question_id
         JOIN quizzes z ON z.id = q.quiz_id
         JOIN participants p ON p.id = a.participant_id
         WHERE q.type = 'text' AND z.ai_grading_enabled = 1 AND coalesce(a.answer_norm, '') <> ''
           AND a.points_awarded IS NULL AND p.submitted_at IS NOT NULL AND ${states} AND ${where}
         ORDER BY a.id`,
      )
      .all(...params) as Candidate[];
    const set = db.prepare(
      `UPDATE answers SET ai_status = ?, ai_error = ?, ${RESET_SUGGESTION}
       WHERE id = ? AND points_awarded IS NULL AND (ai_status IS NULL OR ai_status = 'failed')`,
    );
    for (const c of rows) {
      let status: 'queued' | 'skipped' = 'queued';
      let error: string | null = null;
      if (!hasReference(c)) {
        status = 'skipped';
        error = 'no_reference';
      } else if ([...c.text_answer.trim()].length > TEXT_ANSWER_MAX_CHARS_AI) {
        status = 'skipped';
        error = 'too_long';
      } else if (!answerLooksLikeInjection(c.text_answer) && unanimousPrecedent(db, c)) {
        status = 'skipped';
        error = 'precedent';
      }
      if (set.run(status, error, c.id).changes === 0) continue;
      (status === 'queued' ? out.queued : out.skipped).push(c.id);
      const ids = out.bySession.get(c.session_id) ?? [];
      ids.push(c.id);
      out.bySession.set(c.session_id, ids);
    }
    return out;
  })();
}

export const queueSession = (db: Db, sessionId: number, opts: { includeFailed?: boolean; questionId?: number } = {}) =>
  opts.questionId === undefined
    ? queueAnswers(db, 'a.session_id = ?', [sessionId], opts)
    : queueAnswers(db, 'a.session_id = ? AND a.question_id = ?', [sessionId, opts.questionId], opts);

export const queueParticipant = (db: Db, participantId: number) => queueAnswers(db, 'a.participant_id = ?', [participantId]);

/**
 * After a question's model answer, accepted answers, notes or points changed: suggestions of its
 * UNGRADED answers no longer fit, in every run. They are cleared (a call on its way loses its
 * claim, so its result is dropped) and queued again where eligible. Graded answers keep theirs.
 */
export function requeueQuestionForAi(db: Db, questionId: number): QueueOutcome {
  const cleared = db.transaction(() => {
    const rows = db
      .prepare('SELECT id, session_id FROM answers WHERE question_id = ? AND points_awarded IS NULL AND ai_status IS NOT NULL')
      .all(questionId) as { id: number; session_id: number }[];
    db.prepare(
      `UPDATE answers SET ai_status = NULL, ai_error = NULL, ${RESET_SUGGESTION}
       WHERE question_id = ? AND points_awarded IS NULL AND ai_status IS NOT NULL`,
    ).run(questionId);
    return rows;
  })();
  const out = queueAnswers(db, 'a.question_id = ?', [questionId]);
  for (const r of cleared) {
    const ids = out.bySession.get(r.session_id) ?? [];
    if (!ids.includes(r.id)) ids.push(r.id);
    out.bySession.set(r.session_id, ids);
  }
  return out;
}

/**
 * The quiz's AI switch was turned off: nothing of it may be sent any more. Waiting answers leave the
 * queue and calls on their way lose their claim (their result is dropped). Stored suggestions stay.
 */
export function unqueueQuiz(db: Db, quizId: number): Map<number, number[]> {
  return db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT a.id, a.session_id FROM answers a JOIN questions q ON q.id = a.question_id
         WHERE q.quiz_id = ? AND a.ai_status IN ('queued', 'running')`,
      )
      .all(quizId) as { id: number; session_id: number }[];
    const reset = db.prepare('UPDATE answers SET ai_status = NULL, ai_claim = NULL WHERE id = ?');
    const bySession = new Map<number, number[]>();
    for (const r of rows) {
      reset.run(r.id);
      const ids = bySession.get(r.session_id) ?? [];
      ids.push(r.id);
      bySession.set(r.session_id, ids);
    }
    return bySession;
  })();
}

/** On boot: calls that were on their way when the process stopped are made again. */
export function recoverRunning(db: Db): number {
  db.prepare("UPDATE ai_grading_runs SET error = 'interrupted' WHERE error = 'in_flight'").run();
  return db.prepare("UPDATE answers SET ai_status = 'queued', ai_claim = NULL WHERE ai_status = 'running'").run().changes;
}
