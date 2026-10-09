import { Router } from 'express';
import { db } from '../db';
import { requireAdmin } from '../middleware/jwt';
import { parseQuestionInput } from '../lib/questionInput';
import { uploadImage } from '../middleware/upload';
import { deleteImageFile } from '../lib/uploads';
import { invalidateQuizLanguages } from '../lib/quizLanguages';
import { getQuizWithQuestions as loadQuiz } from '../lib/quizPayload';
import { QuestionWriteError, updateQuestionWithChoices } from '../lib/questionWrite';
import { broadcastGradingChanged, broadcastLiveUpdate } from '../socket';

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
  return loadQuiz(db, quizId);
}

questionsRouter.put('/:id', (req, res) => {
  const question = getQuestion(Number(req.params.id));
  if (!question) return res.status(404).json({ error: 'Question not found' });

  const parsed = parseQuestionInput(req.body);
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });

  let result;
  try {
    result = updateQuestionWithChoices(db, question.id, parsed);
  } catch (err) {
    if (err instanceof QuestionWriteError) return res.status(err.status).json(err.body);
    throw err;
  }
  invalidateQuizLanguages(question.quiz_id);
  for (const [sessionId, answerIds] of result.regradedBySession) {
    broadcastLiveUpdate(sessionId);
    broadcastGradingChanged(sessionId, { kind: 'regrade', answerIds });
  }

  res.json({ quiz: getQuizWithQuestions(question.quiz_id) });
});

questionsRouter.delete('/:id', (req, res) => {
  const question = getQuestion(Number(req.params.id));
  if (!question) return res.status(404).json({ error: 'Question not found' });

  db.prepare('DELETE FROM questions WHERE id = ?').run(question.id);
  deleteImageFile(question.image_path);
  invalidateQuizLanguages(question.quiz_id);

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
