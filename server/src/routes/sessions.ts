import { Router } from 'express';
import { db } from '../db';
import { requireAdmin, AuthedRequest } from '../middleware/jwt';
import { finalizeSession, getSession, SessionRow } from '../lib/sessions';
import { clearSessionTimer, scheduleSessionEnd } from '../lib/sessionTimers';
import { ANSWERED_SQL } from '../lib/grading';
import { nowIso } from '../lib/time';
import { broadcastLiveUpdate, broadcastSessionUpdate, disconnectGraderLink } from '../socket';
import {
  formatGraderCode,
  generateGraderCode,
  GRADER_LABEL_MAX,
  GRADER_LINK_DAYS,
  graderLinkExpiry,
  hashGraderCode,
} from '../lib/graderLinks';

export const sessionsRouter = Router();
sessionsRouter.use(requireAdmin);

interface QuizRow {
  id: number;
  title: string;
  time_limit_seconds: number;
}

interface QuestionRow {
  id: number;
  quiz_id: number;
  sort_order: number;
  type: 'single' | 'multiple' | 'text';
  text: string;
  image_path: string | null;
  points: number;
}

interface ChoiceRow {
  id: number;
  question_id: number;
  text: string;
  is_correct: number;
  sort_order: number;
}

interface ParticipantRow {
  id: number;
  session_id: number;
  display_name: string;
  joined_at: string;
}

interface AnswerRow {
  id: number;
  session_id: number;
  question_id: number;
  participant_id: number;
  selected_choice_ids: string | null;
  text_answer: string | null;
  is_correct: number | null;
  points_awarded: number | null;
  graded_at: string | null;
  submitted_at: string;
}

sessionsRouter.get('/:id', (req, res) => {
  const session = getSession(Number(req.params.id));
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const quiz = db
    .prepare(
      `SELECT q.id, q.title, q.time_limit_seconds, (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS question_count
       FROM quizzes q WHERE q.id = ?`,
    )
    .get(session.quiz_id);
  res.json({ session, quiz });
});

// "Lock joining" (decision Q-lock-joining): new names get 403 JOINING_LOCKED; rejoining stays possible.
sessionsRouter.put('/:id/joining', (req, res) => {
  const { locked } = req.body ?? {};
  if (typeof locked !== 'boolean') return res.status(400).json({ error: 'locked must be a boolean' });
  const session = getSession(Number(req.params.id));
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status === 'ended') {
    return res.status(400).json({ error: 'This session has already ended', code: 'SESSION_ENDED' });
  }
  db.prepare('UPDATE sessions SET joining_locked = ? WHERE id = ?').run(locked ? 1 : 0, session.id);
  const updated = getSession(session.id)!;
  broadcastSessionUpdate(session.id, updated);
  res.json({ session: updated });
});

sessionsRouter.put('/:id/start', (req, res) => {
  const session = getSession(Number(req.params.id));
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'pending') {
    return res.status(400).json({ error: `Cannot start a session with status "${session.status}"` });
  }

  const quiz = db.prepare('SELECT id, time_limit_seconds FROM quizzes WHERE id = ?').get(session.quiz_id) as
    | QuizRow
    | undefined;
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + quiz.time_limit_seconds * 1000);
  if (!Number.isFinite(endsAt.getTime())) return res.status(400).json({ error: 'The quiz has an invalid time limit' });

  db.prepare("UPDATE sessions SET status = 'active', started_at = ?, ends_at = ? WHERE id = ?").run(
    startedAt.toISOString(),
    endsAt.toISOString(),
    session.id,
  );

  const updated: SessionRow = { ...session, status: 'active', started_at: startedAt.toISOString(), ends_at: endsAt.toISOString() };
  broadcastSessionUpdate(session.id, updated);
  // The server ends the session on time even if no screen is open (participants are submitted then).
  scheduleSessionEnd(session.id, updated.ends_at!);
  res.json({ session: updated });
});

sessionsRouter.put('/:id/end', (req, res) => {
  const session = getSession(Number(req.params.id));
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status === 'ended') {
    return res.json({ session });
  }

  // Also cancels a lobby that never started ("Cancel run"); finalizeSession broadcasts the change.
  clearSessionTimer(session.id);
  const updated = finalizeSession(session.id, nowIso());
  res.json({ session: updated });
});

sessionsRouter.get('/:id/live', (req, res) => {
  const session = getSession(Number(req.params.id));
  if (!session) return res.status(404).json({ error: 'Session not found' });

  // Counts only this run's answers (a.session_id), and only real answers (ANSWERED): a quiz that was
  // run before must not show "Answered 8 / 1".
  const participants = db
    .prepare(
      `SELECT p.id, p.display_name, p.joined_at, p.submitted_at, p.submit_source, (p.rejoin_hash IS NULL) AS rejoin_open,
         coalesce(SUM(CASE WHEN ${ANSWERED_SQL} THEN 1 ELSE 0 END), 0) AS answered_count
       FROM participants p
       LEFT JOIN answers a ON a.participant_id = p.id AND a.session_id = p.session_id
       LEFT JOIN questions q ON q.id = a.question_id
       WHERE p.session_id = ?
       GROUP BY p.id
       ORDER BY p.joined_at, p.id`,
    )
    .all(session.id);

  const answeredByQuestion = new Map(
    (
      db
        .prepare(
          `SELECT a.question_id AS id, SUM(CASE WHEN ${ANSWERED_SQL} THEN 1 ELSE 0 END) AS n
           FROM answers a JOIN questions q ON q.id = a.question_id
           WHERE a.session_id = ?
           GROUP BY a.question_id`,
        )
        .all(session.id) as { id: number; n: number }[]
    ).map((r) => [r.id, r.n]),
  );
  const questions = (
    db
      .prepare('SELECT id, sort_order, text, type FROM questions WHERE quiz_id = ? ORDER BY sort_order')
      .all(session.quiz_id) as { id: number }[]
  ).map((q) => ({ ...q, answered_count: answeredByQuestion.get(q.id) ?? 0 }));

  res.json({ session, participants, questions });
});

// Lets a participant's name be claimed again without its rejoin secret (e.g. after switching devices).
sessionsRouter.put('/:id/participants/:participantId/allow-rejoin', (req, res) => {
  const result = db
    .prepare('UPDATE participants SET rejoin_hash = NULL WHERE id = ? AND session_id = ?')
    .run(Number(req.params.participantId), Number(req.params.id));
  if (result.changes === 0) return res.status(404).json({ error: 'Participant not found in this session' });
  broadcastLiveUpdate(Number(req.params.id));
  res.json({ ok: true });
});

sessionsRouter.get('/:id/results', (req, res) => {
  const session = getSession(Number(req.params.id));
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const quiz = db.prepare('SELECT id, title, time_limit_seconds FROM quizzes WHERE id = ?').get(session.quiz_id) as
    | QuizRow
    | undefined;
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const questions = db
    .prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY sort_order')
    .all(session.quiz_id) as QuestionRow[];
  const choiceStmt = db.prepare('SELECT * FROM choices WHERE question_id = ? ORDER BY sort_order');
  const questionsOut = questions.map((q) => ({
    ...q,
    choices: q.type === 'text' ? [] : (choiceStmt.all(q.id) as ChoiceRow[]),
  }));

  const participants = db
    .prepare('SELECT id, session_id, display_name, joined_at, submitted_at FROM participants WHERE session_id = ? ORDER BY joined_at')
    .all(session.id) as ParticipantRow[];
  const answers = db.prepare('SELECT * FROM answers WHERE session_id = ?').all(session.id) as AnswerRow[];

  res.json({ session, quiz, questions: questionsOut, participants, answers });
});

// --- Grader links (wish 8) ----------------------------------------------------------------------
// Grading is done on /api/grading/:sessionId (routes/grading.ts); the old
// PUT /api/sessions/:id/answers/:answerId/grade was removed with S12.

const LINK_COLUMNS = 'id, label, created_at, expires_at, revoked_at, last_used_at';

/** Where a grader link points: PUBLIC_BASE_URL on Render (TLS ends at the proxy), else this request's host. */
function publicBaseUrl(req: { protocol: string; get(name: string): string | undefined }): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, '');
  return configured || `${req.protocol}://${req.get('host')}`;
}

// Creates a grader link. The plain code is in this response only; the database keeps its sha256.
sessionsRouter.post('/:id/grader-links', (req: AuthedRequest, res) => {
  const session = getSession(Number(req.params.id));
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { label, expires_in_days } = req.body ?? {};
  if (label !== undefined && label !== null && typeof label !== 'string') {
    return res.status(400).json({ error: 'label must be a string' });
  }
  const cleanLabel = typeof label === 'string' ? label.trim() : '';
  if (cleanLabel.length > GRADER_LABEL_MAX) {
    return res.status(400).json({ error: `label must be at most ${GRADER_LABEL_MAX} characters` });
  }
  const days = expires_in_days === undefined || expires_in_days === null ? 7 : expires_in_days;
  if (!(GRADER_LINK_DAYS as readonly unknown[]).includes(days)) {
    return res.status(400).json({ error: 'expires_in_days must be 1, 7 or 30' });
  }

  const code = generateGraderCode();
  const createdAt = nowIso();
  const expiresAt = graderLinkExpiry(session.ends_at, days);
  const id = Number(
    db
      .prepare(
        'INSERT INTO grader_links (session_id, code_hash, label, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(session.id, hashGraderCode(code), cleanLabel || null, req.admin!.adminId, createdAt, expiresAt).lastInsertRowid,
  );
  res.setHeader('Cache-Control', 'no-store');
  res.status(201).json({
    link: { id, label: cleanLabel || null, created_at: createdAt, expires_at: expiresAt },
    code: formatGraderCode(code),
    url: `${publicBaseUrl(req)}/g/${code}`,
  });
});

sessionsRouter.get('/:id/grader-links', (req, res) => {
  const session = getSession(Number(req.params.id));
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const links = db.prepare(`SELECT ${LINK_COLUMNS} FROM grader_links WHERE session_id = ? ORDER BY id DESC`).all(session.id);
  res.json({ links });
});

// Revokes a link at once: every grading request reads the link row, and its open panels are disconnected.
sessionsRouter.delete('/:id/grader-links/:linkId', async (req, res, next) => {
  try {
    const sessionId = Number(req.params.id);
    const linkId = Number(req.params.linkId);
    const link = db.prepare('SELECT id, revoked_at FROM grader_links WHERE id = ? AND session_id = ?').get(linkId, sessionId) as
      | { id: number; revoked_at: string | null }
      | undefined;
    if (!link) return res.status(404).json({ error: 'Grader link not found in this session' });
    if (!link.revoked_at) db.prepare('UPDATE grader_links SET revoked_at = ? WHERE id = ?').run(nowIso(), linkId);
    await disconnectGraderLink(sessionId, linkId);
    res.json({ link: db.prepare(`SELECT ${LINK_COLUMNS} FROM grader_links WHERE id = ?`).get(linkId) });
  } catch (err) {
    next(err);
  }
});
