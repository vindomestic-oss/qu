import { Router } from 'express';
import { db } from '../db';
import { requireAdmin } from '../middleware/auth';
import { getSession, SessionRow } from '../lib/sessions';
import { broadcastSessionUpdate } from '../socket';

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
  res.json({ session });
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

  db.prepare("UPDATE sessions SET status = 'active', started_at = ?, ends_at = ? WHERE id = ?").run(
    startedAt.toISOString(),
    endsAt.toISOString(),
    session.id,
  );

  const updated: SessionRow = { ...session, status: 'active', started_at: startedAt.toISOString(), ends_at: endsAt.toISOString() };
  broadcastSessionUpdate(session.id, updated);
  res.json({ session: updated });
});

sessionsRouter.put('/:id/end', (req, res) => {
  const session = getSession(Number(req.params.id));
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status === 'ended') {
    return res.json({ session });
  }

  const endsAt = new Date();
  db.prepare("UPDATE sessions SET status = 'ended', ends_at = ? WHERE id = ?").run(endsAt.toISOString(), session.id);

  const updated: SessionRow = { ...session, status: 'ended', ends_at: endsAt.toISOString() };
  broadcastSessionUpdate(session.id, updated);
  res.json({ session: updated });
});

sessionsRouter.get('/:id/live', (req, res) => {
  const session = getSession(Number(req.params.id));
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const participants = db
    .prepare(
      `SELECT p.id, p.display_name, p.joined_at, COUNT(a.id) as answered_count
       FROM participants p LEFT JOIN answers a ON a.participant_id = p.id
       WHERE p.session_id = ?
       GROUP BY p.id
       ORDER BY p.joined_at`,
    )
    .all(session.id);

  const questions = db
    .prepare(
      `SELECT q.id, q.sort_order, q.text, q.type,
         (SELECT COUNT(*) FROM answers a WHERE a.question_id = q.id) as answered_count
       FROM questions q WHERE q.quiz_id = ? ORDER BY q.sort_order`,
    )
    .all(session.quiz_id);

  res.json({ session, participants, questions });
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
    .prepare('SELECT * FROM participants WHERE session_id = ? ORDER BY joined_at')
    .all(session.id) as ParticipantRow[];
  const answers = db.prepare('SELECT * FROM answers WHERE session_id = ?').all(session.id) as AnswerRow[];

  res.json({ session, quiz, questions: questionsOut, participants, answers });
});

sessionsRouter.put('/:id/answers/:answerId/grade', (req, res) => {
  const session = getSession(Number(req.params.id));
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const answer = db.prepare('SELECT * FROM answers WHERE id = ? AND session_id = ?').get(
    Number(req.params.answerId),
    session.id,
  ) as AnswerRow | undefined;
  if (!answer) return res.status(404).json({ error: 'Answer not found in this session' });

  const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(answer.question_id) as
    | QuestionRow
    | undefined;
  if (!question || question.type !== 'text') {
    return res.status(400).json({ error: 'Only text answers can be graded manually' });
  }

  const pointsAwarded = Number(req.body?.points_awarded);
  if (!Number.isFinite(pointsAwarded) || pointsAwarded < 0 || pointsAwarded > question.points) {
    return res.status(400).json({ error: `points_awarded must be between 0 and ${question.points}` });
  }

  const isCorrect = pointsAwarded >= question.points ? 1 : 0;
  db.prepare("UPDATE answers SET points_awarded = ?, is_correct = ?, graded_at = datetime('now') WHERE id = ?").run(
    pointsAwarded,
    isCorrect,
    answer.id,
  );

  res.json({ answer: { ...answer, points_awarded: pointsAwarded, is_correct: isCorrect } });
});
