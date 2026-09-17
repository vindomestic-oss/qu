import { Router } from 'express';
import { db } from '../db';
import { requireAdmin, AuthedRequest } from '../middleware/auth';
import { parseQuestionInput, extractTranslations } from '../lib/questionInput';
import { deleteImageFile } from '../lib/uploads';
import { createUniqueJoinCode, refreshSessionStatus, SessionRow } from '../lib/sessions';
import { translationColumns, translationValues } from '../lib/sqlTranslations';

export const quizzesRouter = Router();
quizzesRouter.use(requireAdmin);

// Rows selected with `SELECT *` also carry title_de/text_ru/etc. translation
// columns (see lib/languages.ts) that these interfaces don't spell out.
interface QuizRow {
  id: number;
  title: string;
  description: string | null;
  time_limit_seconds: number;
  created_by: number;
  created_at: string;
}

interface QuestionRow {
  id: number;
  quiz_id: number;
  sort_order: number;
  type: string;
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

function getQuizWithQuestions(quizId: number) {
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(quizId) as QuizRow | undefined;
  if (!quiz) return null;

  const questions = db
    .prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY sort_order')
    .all(quizId) as QuestionRow[];

  const choiceStmt = db.prepare('SELECT * FROM choices WHERE question_id = ? ORDER BY sort_order');
  const questionsWithChoices = questions.map((q) => ({
    ...q,
    choices: q.type === 'text' ? [] : (choiceStmt.all(q.id) as ChoiceRow[]),
  }));

  return { ...quiz, questions: questionsWithChoices };
}

// --- Quizzes ---

quizzesRouter.get('/', (_req, res) => {
  const quizzes = db
    .prepare(
      `SELECT q.*, (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) as question_count
       FROM quizzes q ORDER BY q.created_at DESC`,
    )
    .all();
  res.json({ quizzes });
});

quizzesRouter.post('/', (req: AuthedRequest, res) => {
  const { title, description, time_limit_seconds } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const timeLimit = Number(time_limit_seconds);
  if (!Number.isFinite(timeLimit) || timeLimit <= 0) {
    return res.status(400).json({ error: 'time_limit_seconds must be a positive number' });
  }

  const titleTranslations = extractTranslations(req.body, 'title');
  const descriptionTranslations = extractTranslations(req.body, 'description');
  const columns = ['title', ...translationColumns('title'), 'description', ...translationColumns('description'), 'time_limit_seconds', 'created_by'];
  const placeholders = columns.map(() => '?').join(', ');

  const result = db
    .prepare(`INSERT INTO quizzes (${columns.join(', ')}) VALUES (${placeholders})`)
    .run(
      title.trim(),
      ...translationValues(titleTranslations),
      description ?? null,
      ...translationValues(descriptionTranslations),
      timeLimit,
      req.admin!.adminId,
    );

  const quiz = getQuizWithQuestions(Number(result.lastInsertRowid));
  res.status(201).json({ quiz });
});

quizzesRouter.get('/:id', (req, res) => {
  const quiz = getQuizWithQuestions(Number(req.params.id));
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  res.json({ quiz });
});

quizzesRouter.put('/:id', (req, res) => {
  const quizId = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM quizzes WHERE id = ?').get(quizId);
  if (!existing) return res.status(404).json({ error: 'Quiz not found' });

  const { title, description, time_limit_seconds } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const timeLimit = Number(time_limit_seconds);
  if (!Number.isFinite(timeLimit) || timeLimit <= 0) {
    return res.status(400).json({ error: 'time_limit_seconds must be a positive number' });
  }

  const titleTranslations = extractTranslations(req.body, 'title');
  const descriptionTranslations = extractTranslations(req.body, 'description');
  const setClauses = [
    'title = ?',
    ...translationColumns('title').map((c) => `${c} = ?`),
    'description = ?',
    ...translationColumns('description').map((c) => `${c} = ?`),
    'time_limit_seconds = ?',
  ];

  db.prepare(`UPDATE quizzes SET ${setClauses.join(', ')} WHERE id = ?`).run(
    title.trim(),
    ...translationValues(titleTranslations),
    description ?? null,
    ...translationValues(descriptionTranslations),
    timeLimit,
    quizId,
  );

  res.json({ quiz: getQuizWithQuestions(quizId) });
});

quizzesRouter.delete('/:id', (req, res) => {
  const quizId = Number(req.params.id);
  const images = db
    .prepare('SELECT image_path FROM questions WHERE quiz_id = ? AND image_path IS NOT NULL')
    .all(quizId) as { image_path: string }[];

  const result = db.prepare('DELETE FROM quizzes WHERE id = ?').run(quizId);
  if (result.changes === 0) return res.status(404).json({ error: 'Quiz not found' });

  images.forEach((row) => deleteImageFile(row.image_path));
  res.status(204).end();
});

// --- Questions (nested under a quiz) ---

quizzesRouter.post('/:id/questions', (req, res) => {
  const quizId = Number(req.params.id);
  const quiz = db.prepare('SELECT id FROM quizzes WHERE id = ?').get(quizId);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const parsed = parseQuestionInput(req.body);
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });

  const createQuestion = db.transaction(() => {
    const { count } = db
      .prepare('SELECT COUNT(*) as count FROM questions WHERE quiz_id = ?')
      .get(quizId) as { count: number };

    const questionColumns = ['quiz_id', 'sort_order', 'type', 'text', ...translationColumns('text'), 'points'];
    const result = db
      .prepare(`INSERT INTO questions (${questionColumns.join(', ')}) VALUES (${questionColumns.map(() => '?').join(', ')})`)
      .run(quizId, count, parsed.type, parsed.text, ...translationValues(parsed.translations), parsed.points);
    const questionId = Number(result.lastInsertRowid);

    const choiceColumns = ['question_id', 'text', ...translationColumns('text'), 'is_correct', 'sort_order'];
    const insertChoice = db.prepare(
      `INSERT INTO choices (${choiceColumns.join(', ')}) VALUES (${choiceColumns.map(() => '?').join(', ')})`,
    );
    parsed.choices.forEach((c, i) =>
      insertChoice.run(questionId, c.text, ...translationValues(c.translations), c.is_correct ? 1 : 0, i),
    );

    return questionId;
  });

  const questionId = createQuestion();
  res.status(201).json({ quiz: getQuizWithQuestions(quizId) });
});

quizzesRouter.put('/:id/questions/reorder', (req, res) => {
  const quizId = Number(req.params.id);
  const quiz = db.prepare('SELECT id FROM quizzes WHERE id = ?').get(quizId);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const { orderedIds } = req.body ?? {};
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'number')) {
    return res.status(400).json({ error: 'orderedIds must be an array of question ids' });
  }

  const existingIds = (db.prepare('SELECT id FROM questions WHERE quiz_id = ?').all(quizId) as { id: number }[]).map(
    (q) => q.id,
  );
  const sameSet =
    existingIds.length === orderedIds.length && existingIds.every((id) => orderedIds.includes(id));
  if (!sameSet) {
    return res.status(400).json({ error: 'orderedIds must match the quiz\'s current question ids exactly' });
  }

  const reorder = db.transaction(() => {
    const stmt = db.prepare('UPDATE questions SET sort_order = ? WHERE id = ?');
    orderedIds.forEach((id: number, index: number) => stmt.run(index, id));
  });
  reorder();

  res.json({ quiz: getQuizWithQuestions(quizId) });
});

// --- Sessions (nested under a quiz) ---

quizzesRouter.get('/:id/sessions', (req, res) => {
  const quizId = Number(req.params.id);
  const quiz = db.prepare('SELECT id FROM quizzes WHERE id = ?').get(quizId);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const rows = db
    .prepare('SELECT * FROM sessions WHERE quiz_id = ? ORDER BY created_at DESC')
    .all(quizId) as SessionRow[];
  const sessions = rows.map(refreshSessionStatus);
  res.json({ sessions });
});

quizzesRouter.post('/:id/sessions', (req, res) => {
  const quizId = Number(req.params.id);
  const quiz = db.prepare('SELECT id FROM quizzes WHERE id = ?').get(quizId);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const existing = db
    .prepare("SELECT * FROM sessions WHERE quiz_id = ? AND status IN ('pending', 'active') ORDER BY created_at DESC LIMIT 1")
    .get(quizId) as SessionRow | undefined;
  if (existing) {
    return res.json({ session: refreshSessionStatus(existing) });
  }

  const joinCode = createUniqueJoinCode();
  const result = db.prepare('INSERT INTO sessions (quiz_id, join_code) VALUES (?, ?)').run(quizId, joinCode);
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(Number(result.lastInsertRowid));
  res.status(201).json({ session });
});
