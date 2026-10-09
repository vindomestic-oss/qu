import { Router } from 'express';
import { db } from '../db';
import { requireAdmin } from '../middleware/jwt';
import { getQuizWithQuestions } from '../lib/quizPayload';
import { deleteSection, parseSectionInput, updateSection } from '../lib/sections';

// Rubrics by id (wish 10). Creating and reordering are under /api/quizzes/:id/sections.
export const sectionsRouter = Router();
sectionsRouter.use(requireAdmin);

function quizIdOf(sectionId: number): number | null {
  const row = db.prepare('SELECT quiz_id FROM quiz_sections WHERE id = ?').get(sectionId) as { quiz_id: number } | undefined;
  return row ? row.quiz_id : null;
}

// Rename: the base name and all 14 translations (absent keys become NULL, as for every quiz text).
sectionsRouter.put('/:id', (req, res) => {
  const sectionId = Number(req.params.id);
  const quizId = quizIdOf(sectionId);
  if (quizId === null) return res.status(404).json({ error: 'Rubric not found' });

  const parsed = parseSectionInput(req.body);
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });
  updateSection(db, sectionId, parsed);
  res.json({ quiz: getQuizWithQuestions(db, quizId) });
});

// Delete: the rubric's questions stay in the quiz, without a rubric.
sectionsRouter.delete('/:id', (req, res) => {
  const quizId = deleteSection(db, Number(req.params.id));
  if (quizId === null) return res.status(404).json({ error: 'Rubric not found' });
  res.json({ quiz: getQuizWithQuestions(db, quizId) });
});
