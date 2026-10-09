import { Router } from 'express';
import { db } from '../db';
import { staffLabel, type StaffRequest } from '../middleware/staffAuth';
import { ANSWER_GRADE_COLUMNS, gradeAnswer, isConfidentCorrect, type AnswerGrade } from '../lib/grading';
import { broadcastGradingChanged } from '../socket';
import { aiConfig } from '../lib/aiGrading/config';
import { aiSessionStatus } from '../lib/aiGrading/status';
import { enqueueSession } from '../lib/aiGrading/process';
import { notifyRuleGrades } from '../lib/autoCheck';
import { aiRunSession } from '../lib/aiGradingService';

/**
 * The grading panel's AI endpoints (wish 7, layer B, S14), mounted on /api/grading/:sessionId/ai
 * behind requireStaffForSession like the rest of the panel: admins for any session, a grader only
 * for the session of their link; participants never. The AI only suggests: these routes queue
 * answers, report progress, and let a person accept confident-correct suggestions.
 */
export const gradingAiRouter = Router({ mergeParams: true });

const isVersion = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const ITEMS_MAX = 500;

/** Progress, counts, ETA and agreement for this session; the provider's key or model never. */
gradingAiRouter.get('/status', (req: StaffRequest, res) => {
  res.json(aiSessionStatus(db, req.sessionId!, aiConfig(db)));
});

/**
 * "Run AI pre-check" (and Retry): the reference check first, then the AI queue for this session
 * (or one question), failed suggestions again with includeFailed. Nothing is queued while model
 * calls or the quiz's switch are off; the reference check still runs.
 */
gradingAiRouter.post('/run', (req: StaffRequest, res) => {
  const questionId = req.body?.questionId;
  if (questionId !== undefined && !(Number.isSafeInteger(questionId) && questionId > 0)) {
    return res.status(400).json({ error: 'questionId must be a positive whole number' });
  }
  const includeFailed = req.body?.includeFailed === true;
  const sessionId = req.sessionId!;
  const matched = enqueueSession(db, sessionId);
  notifyRuleGrades(sessionId, matched);
  const out = aiRunSession(sessionId, { questionId, includeFailed });
  const config = aiConfig(db);
  res.json({
    ruleMatched: matched.length,
    queued: out.queued.length,
    skipped: out.skipped.length,
    modelCallsEnabled: config.modelCallsEnabled,
    disabledReason: config.disabledReason,
  });
});

interface AcceptRow {
  id: number;
  question_id: number;
  grade_version: number;
  points_awarded: number | null;
  max_points: number;
  submitted_at: string | null;
  ai_status: string | null;
  ai_verdict: string | null;
  ai_confidence: string | null;
  ai_flagged: number;
}

/**
 * "Accept all confident-correct (N)" of one question: exactly the rows the grader saw, each
 * re-checked in one transaction (still a finished, high-confidence, unflagged "correct"
 * suggestion, still ungraded, participant submitted, grade_version unchanged), then graded with
 * full points through the shared versioned write (grade_source 'ai_confirmed', grade_events
 * 'bulk_confirm_ai' with the grader's name and the suggestion's run id). One broadcast.
 */
gradingAiRouter.post('/accept-correct', (req: StaffRequest, res) => {
  const questionId = req.body?.questionId;
  const items = req.body?.items;
  if (!Number.isSafeInteger(questionId) || questionId <= 0) return res.status(400).json({ error: 'questionId must be a positive whole number' });
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    items.length > ITEMS_MAX ||
    !items.every((it) => Number.isSafeInteger(it?.answer_id) && isVersion(it?.expected_version))
  ) {
    return res.status(400).json({ error: `items must be 1–${ITEMS_MAX} entries of {answer_id, expected_version}` });
  }
  const sessionId = req.sessionId!;
  const staff = req.staff!;
  const actor = staffLabel(staff);
  const read = db.prepare(
    `SELECT a.id, a.question_id, a.grade_version, a.points_awarded, q.points AS max_points, p.submitted_at,
       a.ai_status, a.ai_verdict, a.ai_confidence, a.ai_flagged
     FROM answers a JOIN questions q ON q.id = a.question_id JOIN participants p ON p.id = a.participant_id
     WHERE a.id = ? AND a.session_id = ?`,
  );
  const current = db.prepare(`SELECT ${ANSWER_GRADE_COLUMNS} FROM answers WHERE id = ?`);
  type Result = { id: number; ok: true; answer: AnswerGrade } | { id: number; ok: false; error: 'conflict' | 'not_eligible'; current?: AnswerGrade };
  const results = db.transaction((): Result[] =>
    (items as { answer_id: number; expected_version: number }[]).map((it): Result => {
      const row = read.get(it.answer_id, sessionId) as AcceptRow | undefined;
      if (!row || row.question_id !== questionId) return { id: it.answer_id, ok: false, error: 'not_eligible' };
      if (row.grade_version !== it.expected_version) {
        return { id: it.answer_id, ok: false, error: 'conflict', current: current.get(row.id) as AnswerGrade };
      }
      if (!isConfidentCorrect(row) || row.points_awarded !== null || !row.submitted_at) {
        return { id: it.answer_id, ok: false, error: 'not_eligible' };
      }
      const r = gradeAnswer(db, sessionId, {
        answerId: row.id,
        isCorrect: true,
        points: row.max_points,
        expectedVersion: it.expected_version,
        actor,
        linkId: staff.kind === 'grader' ? staff.linkId : null,
        source: 'ai',
        aiAction: 'bulk_confirm_ai',
      });
      if (r.ok) return { id: row.id, ok: true, answer: r.answer };
      return { id: row.id, ok: false, error: r.error === 'conflict' ? 'conflict' : 'not_eligible', ...('current' in r ? { current: r.current } : {}) };
    }),
  )();
  const changed = results.filter((r) => r.ok).map((r) => r.id);
  if (changed.length > 0) broadcastGradingChanged(sessionId, { kind: 'grade', answerIds: changed, by: actor });
  res.json({ results });
});
