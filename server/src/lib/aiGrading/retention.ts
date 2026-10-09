import type Database from 'better-sqlite3';

// Wish 7, layer B (S14): AI output is kept for 180 days (to be confirmed by the DPO together with
// the DPIA). On boot and every 24 h:
//   - the log of AI calls (ai_grading_runs) older than that is deleted;
//   - on answers of sessions that ended longer ago, the free-text AI output (ai_rationale, and
//     ai_error, which can quote a provider message) is cleared. The structured suggestion (status,
//     verdict, confidence, flag) and every grade stay, so the grading record remains complete.
// Sessions themselves are purged by the separate PURGE_SESSIONS_AFTER_DAYS job (S15) if the DPO sets it.

export const AI_RUNS_RETENTION_DAYS = 180;

const cutoffIso = (nowMs: number, days: number) => new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();

/** Deletes runs older than the retention period; returns how many. */
export function purgeAiRuns(db: Database.Database, nowMs = Date.now(), days = AI_RUNS_RETENTION_DAYS): number {
  return db.prepare('DELETE FROM ai_grading_runs WHERE julianday(created_at) < julianday(?)').run(cutoffIso(nowMs, days)).changes;
}

/** Clears the AI's free text on answers of sessions that ended before the retention period; returns how many. */
export function purgeAiAnswerTexts(db: Database.Database, nowMs = Date.now(), days = AI_RUNS_RETENTION_DAYS): number {
  return db
    .prepare(
      `UPDATE answers SET ai_rationale = NULL, ai_error = NULL
       WHERE (ai_rationale IS NOT NULL OR ai_error IS NOT NULL)
         AND session_id IN (SELECT id FROM sessions WHERE status = 'ended' AND ends_at IS NOT NULL AND julianday(ends_at) < julianday(?))`,
    )
    .run(cutoffIso(nowMs, days)).changes;
}

/** Both purges, in one transaction. */
export function purgeAiData(db: Database.Database, nowMs = Date.now(), days = AI_RUNS_RETENTION_DAYS): { runs: number; answers: number } {
  return db.transaction(() => ({ runs: purgeAiRuns(db, nowMs, days), answers: purgeAiAnswerTexts(db, nowMs, days) }))();
}
