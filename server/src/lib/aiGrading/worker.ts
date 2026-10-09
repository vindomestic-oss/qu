import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { nowIso } from '../time';
import { aiConfig, stopModelCalls } from './config';
import { guard } from './guard';
import { answerNormHash, buildPayload, hasReference, PROMPT_VERSION, referenceHash, type QuestionKey } from './prompt';
import type { GradeProvider } from './providers/types';
import { AI_ERROR_MAX_CHARS, isConfidence, isVerdict, TEXT_ANSWER_MAX_CHARS_AI, type GradeResult } from './types';

// Wish 7, layer B (S14): the worker that asks the AI provider about queued answers. One request per
// unique (question, normalized answer): identical answers of any run share one call and one runs
// row. It only ever writes ai_* columns: a suggestion never sets points (a person confirms it).
//
// Claim tokens: a group is claimed with a random token ('queued' -> 'running'); its result applies
// only to rows that still carry that token, so a re-saved answer, a changed key or a quiz switched
// off (all of which clear the token) never get a stale suggestion.
// A result applies only to answers that are still ungraded (a grade given meanwhile wins and the
// answer becomes 'skipped'/'graded'), so the agreement statistics compare only suggestions a person
// saw before deciding.
// Gates, checked before every claim, again right before every request (the provider is called with
// an allowed() gate and no retries of its own) and enforced while a request is on its way (the kill
// switch and switching a quiz off abort it): model calls enabled (AI_GRADING_ENABLED, configured
// provider, kill switch released, no auth stop) and the quiz's switch on. Daily cap:
// AI_MAX_CALLS_PER_DAY rows in ai_grading_runs within 24 h; every request has its own row, written
// before it is sent, so concurrent calls cannot overshoot. Errors: rate limit -> back to the queue
// and a pause (30 s, or longer if the provider asks); 5xx or network -> back to the queue with a
// short pause, at most 3 attempts per answer, then 'failed'; rejected key or unknown model ->
// 'failed' and no further calls until restart; aborted -> back to the queue (resumes when allowed
// again); anything else -> 'failed' with ai_error (the grader sees "AI error"; admins can Retry).
// Identical answers that arrive while their group is on its way wait for it and then use the cache.

type Db = Database.Database;

export interface AiChange {
  answerIds: number[];
  questionIds: number[];
}

export interface WorkerDeps {
  db: Db;
  /** Resolved for every call, so tests can swap it. */
  provider: () => GradeProvider;
  /** Changed answers per session, after each group (for grading:changed in the staff room). */
  onChanged?: (bySession: Map<number, AiChange>) => void;
  now?: () => number;
  rateLimitPauseMs?: number;
  /** Pause after a 5xx or network error, times the attempt number (default 5 s). */
  retryBackoffMs?: number;
  /** Requests per answer for 5xx / network errors before it is 'failed' (default 3). */
  maxTransientAttempts?: number;
}

interface Group {
  questionId: number;
  answerNorm: string;
  claim: string;
}

interface QuestionRow extends QuestionKey {
  id: number;
  quiz_id: number;
  ai_grading_enabled: number;
}

type Row = { id: number; session_id: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const cut = (s: string, max: number) => [...s].slice(0, max).join('');

export function createAiWorker(deps: WorkerDeps) {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const pauseMs = deps.rateLimitPauseMs ?? 30_000;
  const backoffMs = deps.retryBackoffMs ?? 5_000;
  const maxAttempts = deps.maxTransientAttempts ?? 3;
  /** Transient failures per (question, normalized answer), for the attempt limit. */
  const attempts = new Map<string, number>();
  /** Requests on their way, by claim, with their quiz (to abort them when a switch goes off). */
  const inFlightCalls = new Map<string, { controller: AbortController; quizId: number }>();
  let inFlight = 0;
  let pausedUntil = 0;
  let ticking = false;
  let kickPending = false;
  const pending = new Set<Promise<void>>();

  /** Answers of a claim, by session (for notifications). */
  function membersOf(claim: string): { id: number; session_id: number }[] {
    return db.prepare("SELECT id, session_id FROM answers WHERE ai_claim = ? AND ai_status = 'running'").all(claim) as {
      id: number;
      session_id: number;
    }[];
  }

  function notify(questionId: number | null, rows: Row[]) {
    if (rows.length === 0 || !deps.onChanged) return;
    const bySession = new Map<number, AiChange>();
    for (const r of rows) {
      const c = bySession.get(r.session_id) ?? { answerIds: [], questionIds: questionId === null ? [] : [questionId] };
      c.answerIds.push(r.id);
      bySession.set(r.session_id, c);
    }
    deps.onChanged(bySession);
  }

  /** Writes the end state of a claimed group; returns the rows it changed. */
  function finish(group: Group, set: string, params: unknown[]): { id: number; session_id: number }[] {
    return db.transaction(() => {
      const rows = membersOf(group.claim);
      db.prepare(`UPDATE answers SET ${set}, ai_claim = NULL WHERE ai_claim = ? AND ai_status = 'running'`).run(...params, group.claim);
      return rows;
    })();
  }

  const fail = (group: Group, error: string) =>
    finish(group, "ai_status = 'failed', ai_error = ?", [cut(error, AI_ERROR_MAX_CHARS)]);
  const requeue = (group: Group) => finish(group, "ai_status = 'queued'", []);

  /** The suggestion goes to the still ungraded answers of the claim; graded ones become skipped/graded. */
  function applyResult(group: Group, result: GradeResult, flagged: boolean, runId: number, source: 'model' | 'cache'): Row[] {
    return db.transaction(() => {
      const rows = membersOf(group.claim);
      db.prepare(
        `UPDATE answers SET ai_status = 'done', ai_source = ?, ai_verdict = ?, ai_confidence = ?, ai_rationale = ?, ai_flagged = ?,
           ai_run_id = ?, ai_error = NULL, ai_claim = NULL
         WHERE ai_claim = ? AND ai_status = 'running' AND points_awarded IS NULL`,
      ).run(source, result.verdict, result.confidence, result.rationale, flagged ? 1 : 0, runId, group.claim);
      db.prepare(
        "UPDATE answers SET ai_status = 'skipped', ai_error = 'graded', ai_claim = NULL WHERE ai_claim = ? AND ai_status = 'running'",
      ).run(group.claim);
      return rows;
    })();
  }

  /** The next group in quiz order, claimed; null when nothing is queued. */
  function claimNext(): Group | null {
    const { claimed, skipped } = db.transaction(() => {
      // Answers a person graded while they waited need no suggestion any more (open panels are told).
      const graded = db
        .prepare("SELECT id, session_id FROM answers WHERE ai_status = 'queued' AND points_awarded IS NOT NULL")
        .all() as Row[];
      if (graded.length > 0) {
        db.prepare("UPDATE answers SET ai_status = 'skipped', ai_error = 'graded' WHERE ai_status = 'queued' AND points_awarded IS NOT NULL").run();
      }
      // A group whose identical answers are already on their way waits for that call (then the cache).
      const next = db
        .prepare(
          `SELECT a.question_id, a.answer_norm FROM answers a
           JOIN questions q ON q.id = a.question_id JOIN quizzes z ON z.id = q.quiz_id
           WHERE a.ai_status = 'queued' AND z.ai_grading_enabled = 1
             AND NOT EXISTS (SELECT 1 FROM answers r WHERE r.question_id = a.question_id AND r.answer_norm = a.answer_norm
                             AND r.ai_status = 'running')
           GROUP BY a.question_id, a.answer_norm
           ORDER BY MIN(q.sort_order), MIN(a.id)
           LIMIT 1`,
        )
        .get() as { question_id: number; answer_norm: string } | undefined;
      if (!next) return { claimed: null, skipped: graded };
      const claim = randomUUID();
      const changed = db
        .prepare("UPDATE answers SET ai_status = 'running', ai_claim = ? WHERE question_id = ? AND answer_norm = ? AND ai_status = 'queued'")
        .run(claim, next.question_id, next.answer_norm).changes;
      return { claimed: changed > 0 ? { questionId: next.question_id, answerNorm: next.answer_norm, claim } : null, skipped: graded };
    })();
    notify(null, skipped);
    return claimed;
  }

  function loadQuestion(questionId: number): QuestionRow | undefined {
    return db
      .prepare(
        `SELECT q.id, q.quiz_id, q.text, q.reference_answer, q.accepted_answers, q.grader_notes, q.points, z.ai_grading_enabled
         FROM questions q JOIN quizzes z ON z.id = q.quiz_id WHERE q.id = ?`,
      )
      .get(questionId) as QuestionRow | undefined;
  }

  /** Model calls are still allowed for this question and the claim is still held. */
  function mayCall(group: Group): boolean {
    if (!aiConfig(db).modelCallsEnabled) return false;
    const q = loadQuestion(group.questionId);
    return Boolean(q && q.ai_grading_enabled === 1 && membersOf(group.claim).length > 0);
  }

  async function processGroup(group: Group): Promise<void> {
    const q = loadQuestion(group.questionId);
    const rep = db.prepare('SELECT text_answer FROM answers WHERE ai_claim = ? ORDER BY id LIMIT 1').get(group.claim) as
      | { text_answer: string | null }
      | undefined;
    if (!q || !rep) return;
    if (!hasReference(q)) {
      notify(q.id, finish(group, "ai_status = 'skipped', ai_error = 'no_reference'", []));
      return;
    }
    // The participant's text exactly as stored: never rewritten or redacted. An answer saved before
    // the quiz had AI suggestions may be longer than the AI limit: it is not sent at all.
    const studentAnswer = rep.text_answer ?? '';
    if ([...studentAnswer.trim()].length > TEXT_ANSWER_MAX_CHARS_AI) {
      notify(q.id, finish(group, "ai_status = 'skipped', ai_error = 'too_long'", []));
      return;
    }
    const keys = [q.id, answerNormHash(group.answerNorm), referenceHash(q), PROMPT_VERSION] as const;

    const cached = db
      .prepare(
        `SELECT id, verdict, confidence, rationale, injection_suspected, answer_language FROM ai_grading_runs
         WHERE question_id = ? AND answer_norm_hash = ? AND reference_hash = ? AND prompt_version = ? AND requested_model = ?
           AND error IS NULL AND verdict IS NOT NULL
         ORDER BY id DESC LIMIT 1`,
      )
      .get(...keys, deps.provider().model) as
      | { id: number; verdict: string; confidence: string; rationale: string | null; injection_suspected: number | null; answer_language: string | null }
      | undefined;
    if (cached && isVerdict(cached.verdict) && isConfidence(cached.confidence)) {
      const result: GradeResult = {
        verdict: cached.verdict,
        confidence: cached.confidence,
        rationale: cached.rationale ?? '',
        injection_suspected: cached.injection_suspected === 1,
        answer_language: cached.answer_language ?? '',
      };
      notify(q.id, applyResult(group, result, guard(studentAnswer, result).flagged, cached.id, 'cache'));
      return;
    }

    // Last gates before data leaves the server.
    if (!mayCall(group)) {
      notify(q.id, requeue(group));
      return;
    }
    const provider = deps.provider();
    const runId = db.transaction((): number | null => {
      const since = new Date(now() - DAY_MS).toISOString();
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM ai_grading_runs WHERE created_at > ?').get(since) as { n: number };
      if (n >= aiConfig(db).maxCallsPerDay) return null;
      return Number(
        db
          .prepare(
            `INSERT INTO ai_grading_runs (question_id, answer_norm_hash, reference_hash, prompt_version, requested_model, provider, error, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'in_flight', ?)`,
          )
          .run(...keys, provider.model, provider.name, nowIso()).lastInsertRowid,
      );
    })();
    if (runId === null) {
      notify(q.id, fail(group, 'daily_cap'));
      return;
    }

    const controller = new AbortController();
    inFlightCalls.set(group.claim, { controller, quizId: q.quiz_id });
    const started = now();
    const outcome = await provider
      .grade(buildPayload(q, studentAnswer), { signal: controller.signal, allowed: () => mayCall(group) })
      .catch((err: unknown) => ({
      stopReason: 'exception',
      usage: { inputTokens: 0, outputTokens: 0 },
      error: `provider exception: ${err instanceof Error ? err.message : String(err)}`,
      errorKind: 'other' as const,
      result: undefined,
      servedModel: undefined,
      requestId: undefined,
      retryAfterMs: undefined,
    }))
      .finally(() => inFlightCalls.delete(group.claim));
    const latency = now() - started;
    const flags = outcome.result ? guard(studentAnswer, outcome.result) : null;
    const errorText = outcome.result ? null : `${outcome.errorKind ?? 'other'}: ${outcome.error ?? 'no result'}`;
    db.prepare(
      `UPDATE ai_grading_runs SET model = ?, verdict = ?, confidence = ?, rationale = ?, answer_language = ?, injection_suspected = ?,
         guard_hit = ?, stop_reason = ?, request_id = ?, input_tokens = ?, output_tokens = ?, latency_ms = ?, error = ?
       WHERE id = ?`,
    ).run(
      outcome.servedModel ?? null,
      outcome.result?.verdict ?? null,
      outcome.result?.confidence ?? null,
      outcome.result?.rationale ?? null,
      outcome.result?.answer_language ?? null,
      outcome.result ? (outcome.result.injection_suspected ? 1 : 0) : null,
      flags ? (flags.guardHit ? 1 : 0) : null,
      outcome.stopReason,
      outcome.requestId ?? null,
      outcome.usage.inputTokens,
      outcome.usage.outputTokens,
      latency,
      errorText ? cut(errorText, 500) : null,
      runId,
    );

    const key = `${group.questionId}\u0000${group.answerNorm}`;
    if (outcome.result && flags) {
      attempts.delete(key);
      notify(q.id, applyResult(group, outcome.result, flags.flagged, runId, 'model'));
      return;
    }
    switch (outcome.errorKind) {
      case 'aborted':
        // Switched off before or while sending: back to the queue (if the quiz was switched off, its
        // rows already lost the claim and stay out of it); it resumes when calls are allowed again.
        notify(q.id, requeue(group));
        return;
      case 'rate_limit':
        pausedUntil = now() + Math.max(pauseMs, outcome.retryAfterMs ?? 0);
        notify(q.id, requeue(group));
        return;
      case 'server':
      case 'network': {
        const n = (attempts.get(key) ?? 0) + 1;
        if (n < maxAttempts) {
          attempts.set(key, n);
          pausedUntil = now() + backoffMs * n;
          notify(q.id, requeue(group));
          return;
        }
        attempts.delete(key);
        notify(q.id, fail(group, errorText ?? 'other'));
        return;
      }
      case 'auth':
      case 'config':
        stopModelCalls(outcome.errorKind);
        notify(q.id, fail(group, outcome.errorKind));
        return;
      default:
        notify(q.id, fail(group, errorText ?? 'other'));
    }
  }

  /** Starts as many groups as the concurrency allows. Never throws. */
  function tick(): void {
    if (ticking) return;
    ticking = true;
    try {
      for (;;) {
        const config = aiConfig(db);
        if (!config.modelCallsEnabled || now() < pausedUntil || inFlight >= config.concurrency) return;
        const group = claimNext();
        if (!group) return;
        inFlight += 1;
        const p: Promise<void> = processGroup(group)
          .catch((err) => {
            console.error('AI grading: group failed:', err instanceof Error ? err.message : err);
            try {
              fail(group, 'internal_error');
            } catch {
              // the next boot re-queues 'running' rows
            }
          })
          .finally(() => {
            inFlight -= 1;
            pending.delete(p);
            kick();
          });
        pending.add(p);
      }
    } catch (err) {
      console.error('AI grading: tick failed:', err instanceof Error ? err.message : err);
    } finally {
      ticking = false;
    }
  }

  /** Runs a tick soon (after the current request has answered). */
  function kick(): void {
    if (kickPending) return;
    kickPending = true;
    setImmediate(() => {
      kickPending = false;
      tick();
    });
  }

  /** Tests and the eval: ticks until nothing is in flight and nothing more can start. */
  async function drain(): Promise<void> {
    for (;;) {
      tick();
      if (pending.size === 0) return;
      await Promise.allSettled([...pending]);
    }
  }

  /** Aborts requests on their way: all (kill switch) or those of one quiz (its switch went off). */
  function abortInFlight(quizId?: number): number {
    let n = 0;
    for (const call of inFlightCalls.values()) {
      if (quizId !== undefined && call.quizId !== quizId) continue;
      call.controller.abort();
      n += 1;
    }
    return n;
  }

  return {
    tick,
    kick,
    drain,
    abortInFlight,
    inFlight: () => inFlight,
    pausedUntil: () => pausedUntil,
    /** Tests: forget a rate-limit pause. */
    resume: () => {
      pausedUntil = 0;
    },
  };
}

export type AiWorker = ReturnType<typeof createAiWorker>;
