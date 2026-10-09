import type Database from 'better-sqlite3';
import { insertGradeEvent } from '../grading';
import { nowIso } from '../time';
import { matchesKeys, referenceKeys } from './accepted';

// Wish 7, layer A (S13): the reference check. A submitted text answer whose normalized form equals
// the question's model answer or one of its accepted answers gets full points with
// grade_source = 'rule' (shown as "Auto: matches the model answer"). It goes through the same
// versioned path as a human grade: grade_version + 1, a grade_events row, and the caller sends
// grading:changed to the staff room. It never touches an answer that has points (a human grade, an
// automatic choice or blank grade), so a human grade always wins; a grader can override a rule
// grade like any other. Only text answers of participants who have submitted are checked, so
// nothing is graded while a participant can still change the answer, and participants see no
// result before their results page opens after the session (no new data in /api/my/*).
// Nothing leaves the server. Functions take the database as a parameter (this module never
// imports '../db' or lib/sessions); S14 adds the model queue next to the rule step.

type Db = Database.Database;

/** answers.graded_by and grade_events.actor of the grades the reference check writes. */
export const RULE_ACTOR = 'auto';

interface CandidateRow {
  id: number;
  session_id: number;
  question_id: number;
  participant_id: number;
  answer_norm: string | null;
  points_awarded: number | null;
  is_correct: number | null;
  grade_source: string | null;
  grade_version: number;
  submitted: number;
  max_points: number;
  reference_answer: string | null;
  accepted_answers: string | null;
}

const CANDIDATES = `SELECT a.id, a.session_id, a.question_id, a.participant_id, a.answer_norm, a.points_awarded, a.is_correct,
    a.grade_source, a.grade_version, (p.submitted_at IS NOT NULL) AS submitted, q.points AS max_points,
    q.reference_answer, q.accepted_answers
  FROM answers a
  JOIN questions q ON q.id = a.question_id
  JOIN participants p ON p.id = a.participant_id`;

/** Ungraded, non-blank text answers of submitted participants, of questions that have a key at all. */
const PENDING = `q.type = 'text' AND a.points_awarded IS NULL AND p.submitted_at IS NOT NULL AND coalesce(a.answer_norm, '') <> ''
  AND (coalesce(q.reference_answer, '') <> '' OR coalesce(q.accepted_answers, '') NOT IN ('', '[]'))`;

/**
 * Full points by the rule, only while the answer is still ungraded and unchanged since it was read.
 * graded_by is always 'auto'; `actor` is who caused the check, for the audit row ('auto' for submit
 * and session end, "admin:<name> (key edit)" when an admin changed the key).
 */
function writeMatch(db: Db, r: CandidateRow, actor: string = RULE_ACTOR): boolean {
  const changed = db
    .prepare(
      `UPDATE answers SET points_awarded = ?, is_correct = 1, graded_at = ?, graded_by = ?, graded_by_link_id = NULL,
         grade_source = 'rule', grade_version = grade_version + 1
       WHERE id = ? AND points_awarded IS NULL AND grade_version = ?`,
    )
    .run(r.max_points, nowIso(), RULE_ACTOR, r.id, r.grade_version).changes;
  if (changed === 0) return false;
  insertGradeEvent(db, {
    answerId: r.id,
    sessionId: r.session_id,
    questionId: r.question_id,
    participantId: r.participant_id,
    actor,
    action: 'rule_match',
    oldPoints: r.points_awarded,
    newPoints: r.max_points,
    oldIsCorrect: r.is_correct,
    isCorrect: 1,
    gradeSource: 'rule',
  });
  return true;
}

/** Back to "needs review": only a grade the rule itself wrote, unchanged since it was read. */
function writeRevert(db: Db, r: CandidateRow, actor: string): boolean {
  const changed = db
    .prepare(
      `UPDATE answers SET points_awarded = NULL, is_correct = NULL, graded_at = NULL, graded_by = NULL, graded_by_link_id = NULL,
         grade_source = NULL, grade_version = grade_version + 1
       WHERE id = ? AND grade_source = 'rule' AND grade_version = ?`,
    )
    .run(r.id, r.grade_version).changes;
  if (changed === 0) return false;
  insertGradeEvent(db, {
    answerId: r.id,
    sessionId: r.session_id,
    questionId: r.question_id,
    participantId: r.participant_id,
    actor,
    action: 'rule_revert',
    oldPoints: r.points_awarded,
    newPoints: null,
    oldIsCorrect: r.is_correct,
    isCorrect: null,
    gradeSource: null,
  });
  return true;
}

/** Checks the pending answers selected by `where`, in one transaction; returns the ids it credited. */
function matchPending(db: Db, where: string, params: unknown[]): number[] {
  return db.transaction(() => {
    const rows = db.prepare(`${CANDIDATES} WHERE ${PENDING} AND ${where} ORDER BY a.id`).all(...params) as CandidateRow[];
    const keysByQuestion = new Map<number, Set<string>>();
    const matched: number[] = [];
    for (const r of rows) {
      let keys = keysByQuestion.get(r.question_id);
      if (!keys) {
        keys = referenceKeys(r);
        keysByQuestion.set(r.question_id, keys);
      }
      if (matchesKeys(r.answer_norm, keys) && writeMatch(db, r)) matched.push(r.id);
    }
    return matched;
  })();
}

/** One answer (if it is eligible); true when the rule credited it. */
export function processAnswer(db: Db, answerId: number): boolean {
  return matchPending(db, 'a.id = ?', [answerId]).length > 0;
}

/** Every eligible answer of a session (at its end, when everyone counts as submitted). */
export function enqueueSession(db: Db, sessionId: number): number[] {
  return matchPending(db, 'a.session_id = ?', [sessionId]);
}

/** The answers of one participant, right after "Finish and submit". */
export function enqueueParticipant(db: Db, participantId: number): number[] {
  return matchPending(db, 'a.participant_id = ?', [participantId]);
}

/**
 * Re-checks a question after its model answer or accepted answers changed, across all its sessions,
 * in one transaction: a rule grade that no longer matches goes back to "needs review"
 * ('rule_revert'), an ungraded submitted answer that now matches is credited ('rule_match'). Rule
 * grades that still match stay as they are (no audit noise, no version bump under a grader's
 * finger). Grades by people ('human', later 'ai_confirmed') and the automatic choice and blank
 * grades are never touched. `actor` goes into the audit rows (e.g. "admin:alex (key edit)").
 * Returns the changed answer ids per session, for grading:changed.
 */
export function requeueQuestion(db: Db, questionId: number, actor: string = RULE_ACTOR): Map<number, number[]> {
  return db.transaction(() => {
    const changed = new Map<number, number[]>();
    const question = db.prepare('SELECT type, reference_answer, accepted_answers FROM questions WHERE id = ?').get(questionId) as
      | { type: string; reference_answer: string | null; accepted_answers: string | null }
      | undefined;
    if (!question || question.type !== 'text') return changed;
    const keys = referenceKeys(question);
    const rows = db
      .prepare(`${CANDIDATES} WHERE a.question_id = ? AND (a.grade_source = 'rule' OR a.points_awarded IS NULL) ORDER BY a.id`)
      .all(questionId) as CandidateRow[];
    for (const r of rows) {
      const matches = matchesKeys(r.answer_norm, keys);
      let done = false;
      if (r.grade_source === 'rule') {
        if (!matches) done = writeRevert(db, r, actor);
      } else if (r.points_awarded === null && r.submitted && matches) {
        done = writeMatch(db, r, actor);
      }
      if (!done) continue;
      const ids = changed.get(r.session_id) ?? [];
      ids.push(r.id);
      changed.set(r.session_id, ids);
    }
    return changed;
  })();
}
