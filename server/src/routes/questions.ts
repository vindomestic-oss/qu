import { Router } from 'express';
import { db } from '../db';
import { requireAdmin } from '../middleware/auth';
import { parseQuestionInput } from '../lib/questionInput';
import { uploadImage } from '../middleware/upload';
import { deleteImageFile } from '../lib/uploads';
import { translationColumns, translationValues } from '../lib/sqlTranslations';

export const questionsRouter = Router();
questionsRouter.use(requireAdmin);

// Also carries text_de/text_ru/etc. translation columns via SELECT * (see lib/languages.ts).
interface QuestionRow {
  id: number;
  quiz_id: number;
  sort_order: number;
  type: string;
  text: string;
  image_path: string | null;
  points: number;
}

function getQuestion(id: number): QuestionRow | undefined {
  return db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as QuestionRow | undefined;
}

function getQuizWithQuestions(quizId: number) {
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(quizId);
  if (!quiz) return null;
  const questions = db
    .prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY sort_order')
    .all(quizId) as QuestionRow[];
  const choiceStmt = db.prepare('SELECT * FROM choices WHERE question_id = ? ORDER BY sort_order');
  const questionsWithChoices = questions.map((q) => ({
    ...q,
    choices: q.type === 'text' ? [] : choiceStmt.all(q.id),
  }));
  return { ...quiz, questions: questionsWithChoices };
}

questionsRouter.put('/:id', (req, res) => {
  const question = getQuestion(Number(req.params.id));
  if (!question) return res.status(404).json({ error: 'Question not found' });

  const parsed = parseQuestionInput(req.body);
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });

  const update = db.transaction(() => {
    const setClauses = ['type = ?', 'text = ?', ...translationColumns('text').map((c) => `${c} = ?`), 'points = ?'];
    db.prepare(`UPDATE questions SET ${setClauses.join(', ')} WHERE id = ?`).run(
      parsed.type,
      parsed.text,
      ...translationValues(parsed.translations),
      parsed.points,
      question.id,
    );
    db.prepare('DELETE FROM choices WHERE question_id = ?').run(question.id);
    const choiceColumns = ['question_id', 'text', ...translationColumns('text'), 'is_correct', 'sort_order'];
    const insertChoice = db.prepare(
      `INSERT INTO choices (${choiceColumns.join(', ')}) VALUES (${choiceColumns.map(() => '?').join(', ')})`,
    );
    parsed.choices.forEach((c, i) =>
      insertChoice.run(question.id, c.text, ...translationValues(c.translations), c.is_correct ? 1 : 0, i),
    );
  });
  update();

  res.json({ quiz: getQuizWithQuestions(question.quiz_id) });
});

questionsRouter.delete('/:id', (req, res) => {
  const question = getQuestion(Number(req.params.id));
  if (!question) return res.status(404).json({ error: 'Question not found' });

  db.prepare('DELETE FROM questions WHERE id = ?').run(question.id);
  deleteImageFile(question.image_path);

  const remaining = db
    .prepare('SELECT id FROM questions WHERE quiz_id = ? ORDER BY sort_order')
    .all(question.quiz_id) as { id: number }[];
  const resequence = db.transaction(() => {
    const stmt = db.prepare('UPDATE questions SET sort_order = ? WHERE id = ?');
    remaining.forEach((q, i) => stmt.run(i, q.id));
  });
  resequence();

  res.json({ quiz: getQuizWithQuestions(question.quiz_id) });
});

questionsRouter.post('/:id/image', uploadImage.single('image'), (req, res) => {
  const question = getQuestion(Number(req.params.id));
  if (!question) return res.status(404).json({ error: 'Question not found' });
  if (!req.file) return res.status(400).json({ error: 'image file is required' });

  deleteImageFile(question.image_path);

  const imagePath = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE questions SET image_path = ? WHERE id = ?').run(imagePath, question.id);

  res.json({ quiz: getQuizWithQuestions(question.quiz_id) });
});

questionsRouter.delete('/:id/image', (req, res) => {
  const question = getQuestion(Number(req.params.id));
  if (!question) return res.status(404).json({ error: 'Question not found' });

  deleteImageFile(question.image_path);
  db.prepare('UPDATE questions SET image_path = NULL WHERE id = ?').run(question.id);

  res.json({ quiz: getQuizWithQuestions(question.quiz_id) });
});
