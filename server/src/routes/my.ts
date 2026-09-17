import { Router } from 'express';
import { db } from '../db';
import { requireParticipant, ParticipantRequest } from '../middleware/participantAuth';
import { refreshSessionStatus, SessionRow } from '../lib/sessions';
import { gradeChoiceAnswer } from '../lib/grading';
import { broadcastLiveUpdate } from '../socket';
import { translationColumns } from '../lib/sqlTranslations';

export const myRouter = Router();
myRouter.use(requireParticipant);

// Also carries text_de/text_ru/etc. translation columns via SELECT * (see lib/languages.ts).
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

function getSessionForParticipant(req: ParticipantRequest): SessionRow | null {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.participant!.sessionId) as
    | SessionRow
    | undefined;
  if (!row) return null;
  return refreshSessionStatus(row);
}

myRouter.get('/session', (req: ParticipantRequest, res) => {
  const session = getSessionForParticipant(req);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ session, participant: req.participant });
});

myRouter.get('/quiz', (req: ParticipantRequest, res) => {
  const session = getSessionForParticipant(req);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'active') {
    return res.status(400).json({ error: `Quiz is not active (status: ${session.status})` });
  }

  const quizColumns = ['id', 'title', ...translationColumns('title'), 'description', ...translationColumns('description'), 'time_limit_seconds'];
  const quiz = db.prepare(`SELECT ${quizColumns.join(', ')} FROM quizzes WHERE id = ?`).get(session.quiz_id);
  const questions = db
    .prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY sort_order')
    .all(session.quiz_id) as QuestionRow[];
  const choiceColumns = ['id', 'question_id', 'text', ...translationColumns('text'), 'sort_order'];
  const choiceStmt = db.prepare(
    `SELECT ${choiceColumns.join(', ')} FROM choices WHERE question_id = ? ORDER BY sort_order`,
  );

  const myAnswers = db
    .prepare('SELECT * FROM answers WHERE participant_id = ? AND session_id = ?')
    .all(req.participant!.participantId, session.id) as AnswerRow[];
  const answersByQuestion = new Map(myAnswers.map((a) => [a.question_id, a]));

  const questionsOut = questions.map((q) => {
    const existing = answersByQuestion.get(q.id);
    return {
      ...q,
      choices: q.type === 'text' ? [] : choiceStmt.all(q.id),
      myAnswer: existing
        ? {
            selected_choice_ids: existing.selected_choice_ids ? JSON.parse(existing.selected_choice_ids) : [],
            text_answer: existing.text_answer,
          }
        : null,
    };
  });

  res.json({ session, quiz, questions: questionsOut });
});

myRouter.post('/answers/:questionId', (req: ParticipantRequest, res) => {
  const session = getSessionForParticipant(req);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'active') {
    return res.status(400).json({ error: `Cannot submit answers (session status: ${session.status})` });
  }

  const questionId = Number(req.params.questionId);
  const question = db.prepare('SELECT * FROM questions WHERE id = ? AND quiz_id = ?').get(
    questionId,
    session.quiz_id,
  ) as QuestionRow | undefined;
  if (!question) return res.status(404).json({ error: 'Question not found in this quiz' });

  const participantId = req.participant!.participantId;

  if (question.type === 'text') {
    const { text_answer } = req.body ?? {};
    if (typeof text_answer !== 'string') {
      return res.status(400).json({ error: 'text_answer must be a string' });
    }
    db.prepare(
      `INSERT INTO answers (session_id, question_id, participant_id, text_answer, is_correct, points_awarded, submitted_at)
       VALUES (?, ?, ?, ?, NULL, NULL, datetime('now'))
       ON CONFLICT(participant_id, question_id) DO UPDATE SET
         text_answer = excluded.text_answer,
         is_correct = NULL,
         points_awarded = NULL,
         submitted_at = excluded.submitted_at`,
    ).run(session.id, questionId, participantId, text_answer.trim());
    broadcastLiveUpdate(session.id);
    return res.json({ ok: true });
  }

  const { selected_choice_ids } = req.body ?? {};
  if (!Array.isArray(selected_choice_ids) || selected_choice_ids.some((id) => typeof id !== 'number')) {
    return res.status(400).json({ error: 'selected_choice_ids must be an array of numbers' });
  }

  const choices = db.prepare('SELECT * FROM choices WHERE question_id = ?').all(questionId) as ChoiceRow[];
  const validIds = new Set(choices.map((c) => c.id));
  if (!selected_choice_ids.every((id) => validIds.has(id))) {
    return res.status(400).json({ error: 'selected_choice_ids contains an id not belonging to this question' });
  }
  if (question.type === 'single' && selected_choice_ids.length > 1) {
    return res.status(400).json({ error: 'single-choice questions allow only one selected choice' });
  }

  const { isCorrect, pointsAwarded } = gradeChoiceAnswer(choices, selected_choice_ids, question.points);

  db.prepare(
    `INSERT INTO answers (session_id, question_id, participant_id, selected_choice_ids, is_correct, points_awarded, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(participant_id, question_id) DO UPDATE SET
       selected_choice_ids = excluded.selected_choice_ids,
       is_correct = excluded.is_correct,
       points_awarded = excluded.points_awarded,
       submitted_at = excluded.submitted_at`,
  ).run(session.id, questionId, participantId, JSON.stringify(selected_choice_ids), isCorrect ? 1 : 0, pointsAwarded);
  broadcastLiveUpdate(session.id);

  res.json({ ok: true, isCorrect, pointsAwarded });
});

myRouter.get('/results', (req: ParticipantRequest, res) => {
  const session = getSessionForParticipant(req);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'ended') {
    return res.status(400).json({ error: 'Results are only available after the session ends' });
  }

  const questions = db
    .prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY sort_order')
    .all(session.quiz_id) as QuestionRow[];
  const choiceStmt = db.prepare('SELECT * FROM choices WHERE question_id = ? ORDER BY sort_order');
  const answers = db
    .prepare('SELECT * FROM answers WHERE participant_id = ? AND session_id = ?')
    .all(req.participant!.participantId, session.id) as AnswerRow[];
  const answersByQuestion = new Map(answers.map((a) => [a.question_id, a]));

  let scoredPoints = 0;
  let maxPoints = 0;
  let pendingGrading = 0;

  const breakdown = questions.map((q) => {
    maxPoints += q.points;
    const answer = answersByQuestion.get(q.id);
    if (q.type === 'text') {
      if (answer && answer.points_awarded == null) pendingGrading += 1;
      else if (answer) scoredPoints += answer.points_awarded ?? 0;
    } else if (answer) {
      scoredPoints += answer.points_awarded ?? 0;
    }
    return {
      question: { ...q, choices: q.type === 'text' ? [] : (choiceStmt.all(q.id) as ChoiceRow[]) },
      answer: answer
        ? {
            selected_choice_ids: answer.selected_choice_ids ? JSON.parse(answer.selected_choice_ids) : [],
            text_answer: answer.text_answer,
            is_correct: answer.is_correct,
            points_awarded: answer.points_awarded,
          }
        : null,
    };
  });

  res.json({ scoredPoints, maxPoints, pendingGrading, breakdown });
});
