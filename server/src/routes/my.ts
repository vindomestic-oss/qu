import { Router } from 'express';
import { db } from '../db';
import { requireParticipant, ParticipantRequest } from '../middleware/jwt';
import { refreshSessionStatus, SessionRow } from '../lib/sessions';
import { gradeChoiceAnswer } from '../lib/grading';
import { broadcastGradingChanged, broadcastLiveUpdate } from '../socket';
import { nowIso } from '../lib/time';
import { translationColumns } from '../lib/sqlTranslations';
import { getQuizLanguageInfo } from '../lib/quizLanguages';
import { normalizeForMatch } from '../lib/aiGrading/normalize';
import { autoCheckParticipant } from '../lib/autoCheck';
import {
  PARTICIPANT_CHOICE_COLUMNS,
  PARTICIPANT_QUESTION_COLUMNS,
  PARTICIPANT_SECTION_COLUMNS,
  RESULTS_CHOICE_COLUMNS,
} from '../lib/participantColumns';

export const myRouter = Router();
myRouter.use(requireParticipant);

// Participant responses select PARTICIPANT_QUESTION_COLUMNS (which also carry text_de/text_ru/etc.).
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

function getSubmittedAt(participantId: number): string | null {
  const row = db.prepare('SELECT submitted_at FROM participants WHERE id = ?').get(participantId) as
    | { submitted_at: string | null }
    | undefined;
  return row?.submitted_at ?? null;
}

myRouter.get('/session', (req: ParticipantRequest, res) => {
  const session = getSessionForParticipant(req);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  // content_languages feeds the offered list only; it is never sent to participants.
  const quizRow = db.prepare('SELECT id, base_language, content_languages FROM quizzes WHERE id = ?').get(session.quiz_id) as
    | { id: number; base_language: string; content_languages: string | null }
    | undefined;
  const languageInfo = quizRow ? getQuizLanguageInfo(db, quizRow) : null;

  res.json({
    session,
    participant: { ...req.participant, submitted_at: getSubmittedAt(req.participant!.participantId) },
    quiz:
      quizRow && languageInfo
        ? { id: quizRow.id, base_language: languageInfo.base_language, offered_languages: languageInfo.offered }
        : null,
  });
});

// Finish: idempotent. After the session has ended it reports the stored time (finalizeSession
// submitted everyone who had not finished).
myRouter.post('/submit', (req: ParticipantRequest, res) => {
  const session = getSessionForParticipant(req);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const participantId = req.participant!.participantId;
  if (session.status === 'ended') {
    return res.json({ submitted_at: getSubmittedAt(participantId) });
  }
  if (session.status !== 'active') {
    return res.status(400).json({ error: `Cannot finish (session status: ${session.status})` });
  }

  const r = db
    .prepare(
      "UPDATE participants SET submitted_at = coalesce(submitted_at, ?), submit_source = coalesce(submit_source, 'participant') WHERE id = ? AND submitted_at IS NULL",
    )
    .run(nowIso(), participantId);
  if (r.changes > 0) {
    broadcastLiveUpdate(session.id);
    broadcastGradingChanged(session.id, { kind: 'submit', participantId });
    // Wish 7 (S13): answers that match the model answer are credited now (staff room only).
    autoCheckParticipant(session.id, participantId);
  }

  res.json({ submitted_at: getSubmittedAt(participantId) });
});

myRouter.get('/quiz', (req: ParticipantRequest, res) => {
  const session = getSessionForParticipant(req);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'active') {
    return res.status(400).json({ error: `Quiz is not active (status: ${session.status})` });
  }

  const quizColumns = [
    'id',
    'title',
    ...translationColumns('title'),
    'description',
    ...translationColumns('description'),
    'time_limit_seconds',
    'base_language',
    'content_languages',
  ];
  const quizRow = db.prepare(`SELECT ${quizColumns.join(', ')} FROM quizzes WHERE id = ?`).get(session.quiz_id) as {
    id: number;
    base_language: string;
    content_languages: string | null;
  };
  const languageInfo = getQuizLanguageInfo(db, quizRow);
  // The declared list and missing counts are editor data: participants get only the offered list.
  const { content_languages: _declared, ...quizFields } = quizRow;
  const quiz = { ...quizFields, base_language: languageInfo.base_language, offered_languages: languageInfo.offered };
  // Rubrics label the question strip; their order decides the colour (position modulo 6).
  const sections = db
    .prepare(`SELECT ${PARTICIPANT_SECTION_COLUMNS.join(', ')} FROM quiz_sections WHERE quiz_id = ? ORDER BY sort_order, id`)
    .all(session.quiz_id);
  const questions = db
    .prepare(`SELECT ${PARTICIPANT_QUESTION_COLUMNS.join(', ')} FROM questions WHERE quiz_id = ? ORDER BY sort_order`)
    .all(session.quiz_id) as QuestionRow[];
  const choiceStmt = db.prepare(
    `SELECT ${PARTICIPANT_CHOICE_COLUMNS.join(', ')} FROM choices WHERE question_id = ? ORDER BY sort_order`,
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

  res.json({
    session,
    quiz,
    sections,
    questions: questionsOut,
    participant: { submitted_at: getSubmittedAt(req.participant!.participantId) },
  });
});

myRouter.post('/answers/:questionId', (req: ParticipantRequest, res) => {
  const session = getSessionForParticipant(req);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'active') {
    return res.status(400).json({ error: `Cannot submit answers (session status: ${session.status})` });
  }

  const participantId = req.participant!.participantId;
  if (getSubmittedAt(participantId)) {
    return res.status(409).json({ error: 'already_submitted', code: 'ALREADY_SUBMITTED' });
  }

  const questionId = Number(req.params.questionId);
  const question = db.prepare('SELECT * FROM questions WHERE id = ? AND quiz_id = ?').get(
    questionId,
    session.quiz_id,
  ) as QuestionRow | undefined;
  if (!question) return res.status(404).json({ error: 'Question not found in this quiz' });

  if (question.type === 'text') {
    const { text_answer } = req.body ?? {};
    if (typeof text_answer !== 'string') {
      return res.status(400).json({ error: 'text_answer must be a string' });
    }
    const trimmed = text_answer.trim();
    // An unchanged re-save (e.g. a blur without edits) writes nothing, so an existing grade survives.
    const stored = db
      .prepare('SELECT text_answer FROM answers WHERE participant_id = ? AND question_id = ?')
      .get(participantId, questionId) as { text_answer: string | null } | undefined;
    if (stored && (stored.text_answer ?? '').trim() === trimmed) return res.json({ ok: true });
    // A blank answer has nothing to grade: it scores 0 at once ('auto_blank'). Any other text waits
    // for a grader, so earlier grading fields are cleared.
    const isCorrect = trimmed ? null : 0;
    const pointsAwarded = trimmed ? null : 0;
    const gradeSource = trimmed ? null : 'auto_blank';
    // The comparison form for the reference check and grouping (wish 7); NULL for a blank answer.
    const answerNorm = trimmed ? normalizeForMatch(trimmed) : null;
    db.prepare(
      `INSERT INTO answers (session_id, question_id, participant_id, text_answer, answer_norm, is_correct, points_awarded,
         grade_source, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(participant_id, question_id) DO UPDATE SET
         text_answer = excluded.text_answer,
         answer_norm = excluded.answer_norm,
         is_correct = excluded.is_correct,
         points_awarded = excluded.points_awarded,
         grade_source = excluded.grade_source,
         graded_at = NULL,
         graded_by = NULL,
         graded_by_link_id = NULL,
         grade_version = grade_version + 1,
         submitted_at = excluded.submitted_at`,
    ).run(session.id, questionId, participantId, trimmed, answerNorm, isCorrect, pointsAwarded, gradeSource);
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
    `INSERT INTO answers (session_id, question_id, participant_id, selected_choice_ids, is_correct, points_awarded,
       grade_source, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, 'auto_choice', datetime('now'))
     ON CONFLICT(participant_id, question_id) DO UPDATE SET
       selected_choice_ids = excluded.selected_choice_ids,
       is_correct = excluded.is_correct,
       points_awarded = excluded.points_awarded,
       grade_source = 'auto_choice',
       graded_at = NULL,
       graded_by = NULL,
       graded_by_link_id = NULL,
       grade_version = grade_version + 1,
       submitted_at = excluded.submitted_at`,
  ).run(session.id, questionId, participantId, JSON.stringify(selected_choice_ids), isCorrect ? 1 : 0, pointsAwarded);
  broadcastLiveUpdate(session.id);

  res.json({ ok: true });
});

myRouter.get('/results', (req: ParticipantRequest, res) => {
  const session = getSessionForParticipant(req);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'ended') {
    return res.status(400).json({ error: 'Results are only available after the session ends' });
  }

  const quizRow = db.prepare('SELECT id, base_language, content_languages FROM quizzes WHERE id = ?').get(session.quiz_id) as {
    id: number;
    base_language: string;
    content_languages: string | null;
  };
  const { base_language, offered } = getQuizLanguageInfo(db, quizRow);

  const questions = db
    .prepare(`SELECT ${PARTICIPANT_QUESTION_COLUMNS.join(', ')} FROM questions WHERE quiz_id = ? ORDER BY sort_order`)
    .all(session.quiz_id) as QuestionRow[];
  const choiceStmt = db.prepare(
    `SELECT ${RESULTS_CHOICE_COLUMNS.join(', ')} FROM choices WHERE question_id = ? ORDER BY sort_order`,
  );
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

  res.json({ scoredPoints, maxPoints, pendingGrading, breakdown, base_language, offered_languages: offered });
});
