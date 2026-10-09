import type Database from 'better-sqlite3';
import type { AiConfig } from './config';

// Wish 7, layer B (S14): the AI progress of one session for the grading panel: counts, an ETA and
// how often the AI agreed with the graders. Counts only; no answer text, no participant.

export const AGREED_SQL = `((a.ai_verdict = 'correct' AND abs(a.points_awarded - q.points) < 1e-9) OR (a.ai_verdict = 'incorrect' AND a.points_awarded = 0))`;
/** A person decided an answer that had a clear suggestion (correct or incorrect). */
export const COMPARABLE_SQL = `(a.ai_verdict IN ('correct', 'incorrect') AND a.grade_source IN ('human', 'ai_confirmed') AND a.points_awarded IS NOT NULL)`;
const n = (fragment: string) => `coalesce(SUM(CASE WHEN ${fragment} THEN 1 ELSE 0 END), 0)`;

export interface AiSessionStatus {
  /** The quiz's own switch (quizzes.ai_grading_enabled). */
  enabled: boolean;
  configured: boolean;
  modelCallsEnabled: boolean;
  disabledReason: string | null;
  counts: {
    queued: number;
    running: number;
    done: number;
    failed: number;
    skipped: number;
    flagged: number;
    ruleMatched: number;
    awaitingDecision: number;
    notChecked: number;
  };
  /** Rough time until the queue of this session is done, or null without data. */
  etaSeconds: number | null;
  agreement: { agreed: number; total: number };
  perQuestion: { questionId: number; queued: number; agreed: number; total: number; overrides: number; flaggedAmbiguous: boolean }[];
}

export function aiSessionStatus(db: Database.Database, sessionId: number, config: AiConfig): AiSessionStatus {
  const quiz = db
    .prepare('SELECT z.ai_grading_enabled FROM sessions s JOIN quizzes z ON z.id = s.quiz_id WHERE s.id = ?')
    .get(sessionId) as { ai_grading_enabled: number } | undefined;
  const base = `FROM answers a JOIN questions q ON q.id = a.question_id JOIN participants p ON p.id = a.participant_id
    WHERE a.session_id = ? AND q.type = 'text' AND coalesce(a.answer_norm, '') <> '' AND p.submitted_at IS NOT NULL`;
  const c = db
    .prepare(
      `SELECT ${n("a.ai_status = 'queued'")} AS queued, ${n("a.ai_status = 'running'")} AS running,
         ${n("a.ai_status = 'done'")} AS done, ${n("a.ai_status = 'failed'")} AS failed, ${n("a.ai_status = 'skipped'")} AS skipped,
         ${n("a.ai_status = 'done' AND a.ai_flagged = 1")} AS flagged, ${n("a.grade_source = 'rule'")} AS ruleMatched,
         ${n("a.ai_status = 'done' AND a.points_awarded IS NULL")} AS awaitingDecision,
         ${n('a.ai_status IS NULL AND a.points_awarded IS NULL')} AS notChecked,
         ${n(COMPARABLE_SQL)} AS total, ${n(`${COMPARABLE_SQL} AND ${AGREED_SQL}`)} AS agreed
       ${base}`,
    )
    .get(sessionId) as Record<string, number>;
  const perQuestion = (
    db
      .prepare(
        `SELECT q.id AS questionId, ${n("a.ai_status IN ('queued', 'running')")} AS queued,
           ${n(COMPARABLE_SQL)} AS total, ${n(`${COMPARABLE_SQL} AND ${AGREED_SQL}`)} AS agreed
         ${base}
         GROUP BY q.id ORDER BY MIN(q.sort_order)`,
      )
      .all(sessionId) as { questionId: number; queued: number; total: number; agreed: number }[]
  ).map((r) => {
    const overrides = r.total - r.agreed;
    return { ...r, overrides, flaggedAmbiguous: r.total >= 5 && overrides / r.total > 0.2 };
  });

  // Unique answers still to send (identical answers share one call), at the configured concurrency.
  const { groups } = db
    .prepare(
      `SELECT COUNT(*) AS groups FROM (SELECT 1 ${base} AND a.ai_status IN ('queued', 'running') GROUP BY a.question_id, a.answer_norm)`,
    )
    .get(sessionId) as { groups: number };
  const latencies = (
    db
      .prepare('SELECT latency_ms FROM ai_grading_runs WHERE latency_ms IS NOT NULL AND error IS NULL ORDER BY id DESC LIMIT 50')
      .all() as { latency_ms: number }[]
  )
    .map((r) => r.latency_ms)
    .sort((x, y) => x - y);
  const median = latencies.length > 0 ? latencies[Math.floor(latencies.length / 2)] : null;
  const etaSeconds = groups === 0 ? 0 : median === null ? null : Math.ceil((groups / Math.max(1, config.concurrency)) * (median / 1000));

  return {
    enabled: quiz?.ai_grading_enabled === 1,
    configured: config.configured,
    modelCallsEnabled: config.modelCallsEnabled,
    disabledReason: config.disabledReason,
    counts: {
      queued: c.queued,
      running: c.running,
      done: c.done,
      failed: c.failed,
      skipped: c.skipped,
      flagged: c.flagged,
      ruleMatched: c.ruleMatched,
      awaitingDecision: c.awaitingDecision,
      notChecked: c.notChecked,
    },
    etaSeconds,
    agreement: { agreed: c.agreed, total: c.total },
    perQuestion,
  };
}
