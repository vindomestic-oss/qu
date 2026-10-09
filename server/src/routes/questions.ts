import { Router } from 'express';
import { db } from '../db';
import { requireAdmin, type AuthedRequest } from '../middleware/jwt';
import { parseQuestionInput } from '../lib/questionInput';
import { uploadImage } from '../middleware/upload';
import { deleteImageFile } from '../lib/uploads';
import { invalidateQuizLanguages } from '../lib/quizLanguages';
import { getQuizWithQuestions as loadQuiz } from '../lib/quizPayload';
import { QuestionWriteError, updateQuestionWithChoices } from '../lib/questionWrite';
import { broadcastGradingChanged, broadcastLiveUpdate } from '../socket';
import { insertGradeEvent } from '../lib/grading';
import { notifyKeyChanged, notifyRuleGrades } from '../lib/autoCheck';
import { normalizeForMatch, stripInvisible } from '../lib/aiGrading/normalize';
import { requeueQuestion } from '../lib/aiGrading/process';
import {
  ACCEPTED_MAX_CHARS,
  ACCEPTED_MAX_ITEMS,
  matchesKeys,
  parseAccepted,
  referenceKeys,
} from '../lib/aiGrading/accepted';

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

questionsRouter.put('/:id', (req: AuthedRequest, res) => {
  const question = getQuestion(Number(req.params.id));
  if (!question) return res.status(404).json({ error: 'Question not found' });

  const parsed = parseQuestionInput(req.body);
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });

  let result;
  try {
    result = updateQuestionWithChoices(db, question.id, parsed, `admin:${req.admin!.username}`);
  } catch (err) {
    if (err instanceof QuestionWriteError) return res.status(err.status).json(err.body);
    throw err;
  }
  invalidateQuizLanguages(question.quiz_id);
  for (const [sessionId, answerIds] of result.regradedBySession) {
    broadcastLiveUpdate(sessionId);
    broadcastGradingChanged(sessionId, { kind: 'regrade', answerIds });
  }
  for (const [sessionId, answerIds] of result.ruleChangedBySession) notifyRuleGrades(sessionId, answerIds);
  if (result.gradingInputsChanged) notifyKeyChanged(question.id);

  res.json({ quiz: getQuizWithQuestions(question.quiz_id) });
});

/**
 * Wish 7 (S13): an admin adds a participant's answer to the question's accepted answers, e.g. after
 * a grader credited a spelling the key did not list. Body {answerId}. The answer's text, trimmed and
 * without invisible or bidi control characters, is appended unless the model answer or an accepted answer already matches it (then `added: false`);
 * 400 when the answer belongs to another question or is blank, or the list would exceed 30 entries
 * of 120 characters. One transaction: the list, a grade_events row 'accept_variant' on that answer
 * (its grade is unchanged) and the reference check of the question in every session (a human
 * grade is never touched). Admin only.
 */
questionsRouter.post('/:id/accepted-answers', (req: AuthedRequest, res) => {
  const answerId = req.body?.answerId;
  if (!Number.isSafeInteger(answerId) || answerId <= 0) return res.status(400).json({ error: 'answerId must be a positive whole number' });
  const actor = `admin:${req.admin!.username}`;
  let out: { added: boolean; list: string[]; changed: Map<number, number[]> };
  try {
    out = db.transaction(() => {
      const q = db.prepare('SELECT id, type, reference_answer, accepted_answers FROM questions WHERE id = ?').get(Number(req.params.id)) as
        | { id: number; type: string; reference_answer: string | null; accepted_answers: string | null }
        | undefined;
      if (!q) throw new QuestionWriteError(404, 'Question not found');
      if (q.type !== 'text') throw new QuestionWriteError(400, 'Only text questions have accepted answers', 'not_text');
      const a = db
        .prepare('SELECT id, session_id, question_id, participant_id, text_answer, points_awarded, is_correct, grade_source FROM answers WHERE id = ?')
        .get(answerId) as
        | {
            id: number;
            session_id: number;
            question_id: number;
            participant_id: number;
            text_answer: string | null;
            points_awarded: number | null;
            is_correct: number | null;
            grade_source: string | null;
          }
        | undefined;
      if (!a) throw new QuestionWriteError(404, 'Answer not found');
      if (a.question_id !== q.id) throw new QuestionWriteError(400, 'The answer belongs to another question', 'wrong_question');
      const value = stripInvisible(a.text_answer ?? '').trim();
      const norm = normalizeForMatch(value);
      if (norm === '') throw new QuestionWriteError(400, 'The answer is blank', 'blank_answer');
      const list = parseAccepted(q.accepted_answers);
      if (matchesKeys(norm, referenceKeys(q))) return { added: false, list, changed: new Map<number, number[]>() };
      if ([...value].length > ACCEPTED_MAX_CHARS) {
        throw new QuestionWriteError(400, `Accepted answers are at most ${ACCEPTED_MAX_CHARS} characters`, 'too_long');
      }
      if (list.length >= ACCEPTED_MAX_ITEMS) {
        throw new QuestionWriteError(400, `A question has at most ${ACCEPTED_MAX_ITEMS} accepted answers`, 'too_many');
      }
      const next = [...list, value];
      db.prepare('UPDATE questions SET accepted_answers = ? WHERE id = ?').run(JSON.stringify(next), q.id);
      insertGradeEvent(db, {
        answerId: a.id,
        sessionId: a.session_id,
        questionId: q.id,
        participantId: a.participant_id,
        actor,
        action: 'accept_variant',
        oldPoints: a.points_awarded,
        newPoints: a.points_awarded,
        oldIsCorrect: a.is_correct,
        isCorrect: a.is_correct,
        gradeSource: a.grade_source,
      });
      return { added: true, list: next, changed: requeueQuestion(db, q.id, `${actor} (key edit)`) };
    })();
  } catch (err) {
    if (err instanceof QuestionWriteError) return res.status(err.status).json(err.body);
    throw err;
  }
  let regraded = 0;
  for (const [sessionId, answerIds] of out.changed) {
    regraded += answerIds.length;
    notifyRuleGrades(sessionId, answerIds);
  }
  if (out.added) notifyKeyChanged(Number(req.params.id));
  res.json({ accepted_answers: out.list, added: out.added, regraded });
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
