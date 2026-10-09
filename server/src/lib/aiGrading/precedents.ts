import type Database from 'better-sqlite3';

// Precedent hints (wish 7, S13): how people graded the same normalized answer to the same question
// in OTHER runs of the quiz. Computed on read, nothing is stored. Counts and points only: no
// session, participant or grader leaves this function.

export interface Precedent {
  /** The distinct points people gave, ascending (one value = they agreed). */
  points: number[];
  /** How many answers they graded. */
  n: number;
}

/** Grades given by a person; rule, choice and blank grades are not precedents. */
const HUMAN_SOURCES = "('human', 'ai_confirmed')";

/**
 * Per text question of the session: {answer_norm: precedent} for the answers of this session
 * (or only of one participant). Questions and answers without precedent are left out.
 */
export function loadPrecedents(
  db: Database.Database,
  sessionId: number,
  participantId?: number,
): Map<number, Record<string, Precedent>> {
  const own =
    participantId === undefined
      ? 'SELECT question_id, answer_norm FROM answers WHERE session_id = ? AND coalesce(answer_norm, \'\') <> \'\''
      : 'SELECT question_id, answer_norm FROM answers WHERE session_id = ? AND participant_id = ? AND coalesce(answer_norm, \'\') <> \'\'';
  const rows = db
    .prepare(
      `SELECT a.question_id, a.answer_norm, a.points_awarded AS points, COUNT(*) AS n
       FROM answers a JOIN questions q ON q.id = a.question_id
       WHERE q.type = 'text' AND a.session_id <> ? AND a.grade_source IN ${HUMAN_SOURCES} AND a.points_awarded IS NOT NULL
         AND (a.question_id, a.answer_norm) IN (${own})
       GROUP BY a.question_id, a.answer_norm, a.points_awarded
       ORDER BY a.question_id, a.answer_norm, a.points_awarded`,
    )
    .all(sessionId, sessionId, ...(participantId === undefined ? [] : [participantId])) as {
    question_id: number;
    answer_norm: string;
    points: number;
    n: number;
  }[];
  const out = new Map<number, Record<string, Precedent>>();
  for (const r of rows) {
    const byNorm = out.get(r.question_id) ?? {};
    const p = byNorm[r.answer_norm] ?? { points: [], n: 0 };
    p.points.push(r.points);
    p.n += r.n;
    byNorm[r.answer_norm] = p;
    out.set(r.question_id, byNorm);
  }
  return out;
}
