import type Database from 'better-sqlite3';

// Wish 7, layer B (S14): the log of AI calls (ai_grading_runs) is kept for 180 days (to be
// confirmed by the DPO together with the DPIA), then deleted. Runs on boot and every 24 h. Only
// ai_grading_runs is purged here; answers and their grades stay (sessions are purged by the
// separate PURGE_SESSIONS_AFTER_DAYS job of S15, when the DPO sets it).

export const AI_RUNS_RETENTION_DAYS = 180;

/** Deletes runs older than the retention period; returns how many. */
export function purgeAiRuns(db: Database.Database, nowMs = Date.now(), days = AI_RUNS_RETENTION_DAYS): number {
  const cutoff = new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare('DELETE FROM ai_grading_runs WHERE julianday(created_at) < julianday(?)').run(cutoff).changes;
}
