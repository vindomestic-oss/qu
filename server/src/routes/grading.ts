import { createHash } from 'crypto';
import { Router, type Response } from 'express';
import { db } from '../db';
import { staffLabel, type StaffRequest } from '../middleware/staffAuth';
import { getSession } from '../lib/sessions';
import { translationColumns } from '../lib/sqlTranslations';
import { getQuizLanguageInfo } from '../lib/quizLanguages';
import {
  ANSWERED_SQL,
  AWAITING_SUBMISSION_SQL,
  CORRECT_SQL,
  INCORRECT_SQL,
  NEEDS_REVIEW_SQL,
  ANSWER_GRADE_COLUMNS,
  gradeAnswer,
  participantStatus,
  type GradeResult,
} from '../lib/grading';
import { broadcastGradingChanged } from '../socket';
import { matchesKeys, parseAccepted, referenceKeys } from '../lib/aiGrading/accepted';
import { loadPrecedents, type Precedent } from '../lib/aiGrading/precedents';

/**
 * The grading panel's API (wish 8), mounted on /api/grading/:sessionId behind requireStaffForSession:
 * admins for any session, graders only for the session of their link. Every query joins answers on
 * a.session_id, so a second run of the same quiz never mixes in.
 *
 * Names (decision Q-names, wish 8): admins and graders see participants' names in the participant
 * list and on the participant page. Whole-quiz mode never carries names or participant ids for
 * anyone: its rows are "Answer 1, 2…" in a hash order. The projector shows counts only (S6).
 *
 * Reference check (wish 7, S13): text answers carry answer_norm (for grouping identical answers on
 * the client; never displayed) and matches_reference; text questions carry their parsed
 * accepted_answers and `precedents` (earlier human grades of the same normalized answer in other
 * runs: points and counts only); whole-quiz stats carry rule_matched (credited by the rule here).
 *
 * AI suggestions (wish 7, S14): the quiz meta carries ai_grading_enabled; text answers carry the
 * suggestion (AI_ANSWER_FIELDS: status, verdict, confidence, rationale, flagged, error, source),
 * never the run's tokens or model. Grades may be sent with source 'ai' (an accepted suggestion).
 * The AI endpoints themselves are in routes/gradingAi.ts.
 */
export const gradingRouter = Router({ mergeParams: true });

const round1 = (n: number) => Math.round(n * 10) / 10;

interface QuizRow {
  id: number;
  title: string;
  base_language: string;
  content_languages: string | null;
  ai_grading_enabled: number;
}

function loadQuiz(quizId: number) {
  const quiz = db.prepare('SELECT id, title, base_language, content_languages, ai_grading_enabled FROM quizzes WHERE id = ?').get(quizId) as
    | QuizRow
    | undefined;
  if (!quiz) return null;
  const totals = db
    .prepare('SELECT COUNT(*) AS question_count, coalesce(SUM(points), 0) AS total_points FROM questions WHERE quiz_id = ?')
    .get(quizId) as { question_count: number; total_points: number };
  const languages = getQuizLanguageInfo(db, quiz);
  return {
    id: quiz.id,
    title: quiz.title,
    question_count: totals.question_count,
    total_points: round1(totals.total_points),
    base_language: languages.base_language,
    offered_languages: languages.offered,
    ai_grading_enabled: quiz.ai_grading_enabled === 1,
  };
}

// --- Question and answer shapes ---------------------------------------------------------------

const QUESTION_COLUMNS = [
  'id',
  'sort_order',
  'type',
  'text',
  ...translationColumns('text'),
  'image_path',
  'points',
  'reference_answer',
  'accepted_answers',
  'grader_notes',
];
const CHOICE_COLUMNS = ['id', 'question_id', 'text', ...translationColumns('text'), 'is_correct', 'sort_order'];

interface QuestionRow {
  id: number;
  sort_order: number;
  type: 'single' | 'multiple' | 'text';
  points: number;
  reference_answer: string | null;
  accepted_answers: string | null;
  [column: string]: unknown;
}
interface ChoiceRow {
  id: number;
  question_id: number;
  [column: string]: unknown;
}

/**
 * The quiz's questions with their choices and the graders' fields, in order: accepted_answers parsed
 * (empty for choice types) and `keys`, the match keys of the reference check (server side only).
 */
function loadQuestions(quizId: number) {
  const questions = db
    .prepare(`SELECT ${QUESTION_COLUMNS.join(', ')} FROM questions WHERE quiz_id = ? ORDER BY sort_order`)
    .all(quizId) as QuestionRow[];
  const choices = db
    .prepare(
      `SELECT ${CHOICE_COLUMNS.map((c) => `c.${c}`).join(', ')} FROM choices c JOIN questions q ON q.id = c.question_id
       WHERE q.quiz_id = ? ORDER BY c.question_id, c.sort_order`,
    )
    .all(quizId) as ChoiceRow[];
  const byQuestion = new Map<number, ChoiceRow[]>();
  for (const c of choices) {
    const list = byQuestion.get(c.question_id) ?? [];
    const { question_id: _q, ...rest } = c;
    list.push(rest as ChoiceRow);
    byQuestion.set(c.question_id, list);
  }
  return questions.map((q) => ({
    ...q,
    accepted_answers: q.type === 'text' ? parseAccepted(q.accepted_answers) : [],
    choices: q.type === 'text' ? [] : (byQuestion.get(q.id) ?? []),
    keys: q.type === 'text' ? referenceKeys(q) : new Set<string>(),
  }));
}

type LoadedQuestion = ReturnType<typeof loadQuestions>[number];

/** A question as the panel receives it: without the server-side match keys, with its precedents. */
function questionOut(q: LoadedQuestion, precedents: Map<number, Record<string, Precedent>>) {
  const { keys: _keys, ...rest } = q;
  return q.type === 'text' ? { ...rest, precedents: precedents.get(q.id) ?? {} } : rest;
}

interface AnswerRow {
  id: number;
  question_id: number;
  participant_id: number;
  selected_choice_ids: string | null;
  text_answer: string | null;
  is_correct: number | null;
  points_awarded: number | null;
  graded_at: string | null;
  graded_by: string | null;
  grade_source: string | null;
  grade_version: number;
  answer_norm: string | null;
  ai_status: string | null;
  ai_source: string | null;
  ai_verdict: string | null;
  ai_confidence: string | null;
  ai_rationale: string | null;
  ai_flagged: number;
  ai_error: string | null;
}

/** The AI suggestion of a text answer as the panel receives it (wish 7, S14). */
const AI_ANSWER_FIELDS = ['ai_status', 'ai_source', 'ai_verdict', 'ai_confidence', 'ai_rationale', 'ai_flagged', 'ai_error'] as const;

const ANSWER_COLUMNS =
  'a.id, a.question_id, a.participant_id, a.selected_choice_ids, a.text_answer, a.answer_norm, a.is_correct, a.points_awarded, a.graded_at, a.graded_by, a.grade_source, a.grade_version, ' +
  AI_ANSWER_FIELDS.map((f) => `a.${f}`).join(', ');

function aiFieldsOf(a: Pick<AnswerRow, (typeof AI_ANSWER_FIELDS)[number]>) {
  return {
    ai_status: a.ai_status,
    ai_source: a.ai_source,
    ai_verdict: a.ai_verdict,
    ai_confidence: a.ai_confidence,
    ai_rationale: a.ai_rationale,
    ai_flagged: a.ai_flagged === 1,
    ai_error: a.ai_error,
  };
}

function parseIds(raw: string | null): number[] {
  try {
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((id): id is number => typeof id === 'number') : [];
  } catch {
    return [];
  }
}

/** The grading fields of an answer for the panel; never the participant. */
function answerOut(a: AnswerRow, q: { type: string; keys: Set<string> }) {
  return {
    id: a.id,
    ...(q.type === 'text'
      ? {
          text_answer: a.text_answer ?? '',
          answer_norm: a.answer_norm,
          matches_reference: matchesKeys(a.answer_norm, q.keys),
          ...aiFieldsOf(a),
        }
      : { selected_choice_ids: parseIds(a.selected_choice_ids) }),
    is_correct: a.is_correct,
    points_awarded: a.points_awarded,
    graded_at: a.graded_at,
    graded_by: a.graded_by,
    grade_source: a.grade_source,
    grade_version: a.grade_version,
  };
}

function isAnswered(type: string, a: AnswerRow | undefined): boolean {
  if (!a) return false;
  return type === 'text' ? (a.text_answer ?? '').trim() !== '' : parseIds(a.selected_choice_ids).length > 0;
}

// --- Summary ----------------------------------------------------------------------------------

interface ParticipantAggregate {
  id: number;
  display_name: string;
  joined_at: string;
  submitted_at: string | null;
  submit_source: string | null;
  answered_count: number;
  needs_review_count: number;
  correct_count: number;
  incorrect_count: number;
  awaiting_count: number;
  score: number;
}

const sum = (fragment: string) => `coalesce(SUM(CASE WHEN ${fragment} THEN 1 ELSE 0 END), 0)`;

gradingRouter.get('/summary', (req: StaffRequest, res) => {
  const session = getSession(req.sessionId!)!;
  const quiz = loadQuiz(session.quiz_id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  const staff = req.staff!;

  const rows = db
    .prepare(
      `SELECT p.id, p.display_name, p.joined_at, p.submitted_at, p.submit_source,
         ${sum(ANSWERED_SQL)} AS answered_count,
         ${sum(NEEDS_REVIEW_SQL)} AS needs_review_count,
         ${sum(CORRECT_SQL)} AS correct_count,
         ${sum(INCORRECT_SQL)} AS incorrect_count,
         ${sum(AWAITING_SUBMISSION_SQL)} AS awaiting_count,
         coalesce(SUM(CASE WHEN q.id IS NOT NULL THEN a.points_awarded END), 0) AS score
       FROM participants p
       LEFT JOIN answers a ON a.participant_id = p.id AND a.session_id = p.session_id
       LEFT JOIN questions q ON q.id = a.question_id
       WHERE p.session_id = ?
       GROUP BY p.id
       ORDER BY p.joined_at, p.id`,
    )
    .all(session.id) as ParticipantAggregate[];

  const participants = rows.map((p, i) => ({
    id: p.id,
    number: i + 1,
    display_name: p.display_name,
    answered_count: p.answered_count,
    needs_review_count: p.needs_review_count,
    score: round1(p.score),
    max_score: quiz.total_points,
    submitted_at: p.submitted_at,
    submit_source: p.submit_source,
    status: participantStatus(p),
  }));

  const total = (key: keyof ParticipantAggregate) => rows.reduce((n, r) => n + Number(r[key]), 0);
  const counters = {
    participants_joined: rows.length,
    participants_answering: participants.filter((p) => p.status === 'answering').length,
    participants_submitted: rows.filter((p) => p.submitted_at).length,
    answers_given: total('answered_count'),
    answers_possible: rows.length * quiz.question_count,
    correct: total('correct_count'),
    incorrect: total('incorrect_count'),
    needs_review: total('needs_review_count'),
    awaiting_submission: total('awaiting_count'),
  };

  const questions = (
    db
      .prepare(
        `SELECT q.id, q.sort_order, q.type, q.text, q.points,
           ${sum(ANSWERED_SQL)} AS answered_count,
           ${sum(CORRECT_SQL)} AS correct_count,
           ${sum(INCORRECT_SQL)} AS incorrect_count,
           ${sum(NEEDS_REVIEW_SQL)} AS needs_review_count
         FROM questions q
         LEFT JOIN answers a ON a.question_id = q.id AND a.session_id = ?
         LEFT JOIN participants p ON p.id = a.participant_id
         WHERE q.quiz_id = ?
         GROUP BY q.id
         ORDER BY q.sort_order`,
      )
      .all(session.id, session.quiz_id) as {
      id: number;
      sort_order: number;
      type: string;
      text: string;
      points: number;
      answered_count: number;
      correct_count: number;
      incorrect_count: number;
      needs_review_count: number;
    }[]
  ).map(({ incorrect_count, ...q }) => {
    const graded = q.correct_count + incorrect_count;
    // Share of correct among the graded answers; null until one is graded.
    return { ...q, correct_rate: graded > 0 ? q.correct_count / graded : null };
  });

  res.json({
    session: { id: session.id, status: session.status, started_at: session.started_at, ends_at: session.ends_at },
    quiz,
    viewer: { kind: staff.kind, name: staff.name },
    counters,
    participants,
    questions,
  });
});

// --- One participant --------------------------------------------------------------------------

gradingRouter.get('/participants/:participantId', (req: StaffRequest, res) => {
  const session = getSession(req.sessionId!)!;
  const quiz = loadQuiz(session.quiz_id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  const participantId = Number(req.params.participantId);

  const order = db
    .prepare('SELECT id, display_name, joined_at, submitted_at, submit_source FROM participants WHERE session_id = ? ORDER BY joined_at, id')
    .all(session.id) as { id: number; display_name: string; joined_at: string; submitted_at: string | null; submit_source: string | null }[];
  const index = order.findIndex((p) => p.id === participantId);
  if (index < 0) return res.status(404).json({ error: 'Participant not found in this session' });
  const p = order[index];

  const questions = loadQuestions(session.quiz_id);
  const precedents = loadPrecedents(db, session.id, p.id);
  const answers = db
    .prepare(`SELECT ${ANSWER_COLUMNS} FROM answers a WHERE a.participant_id = ? AND a.session_id = ?`)
    .all(p.id, session.id) as AnswerRow[];
  const byQuestion = new Map(answers.map((a) => [a.question_id, a]));

  let score = 0;
  let answered = 0;
  let needsReview = 0;
  const items = questions.map((q) => {
    const a = byQuestion.get(q.id);
    const given = isAnswered(q.type, a);
    if (given) answered += 1;
    if (a?.points_awarded != null) score += a.points_awarded;
    if (q.type === 'text' && given && a!.points_awarded == null && p.submitted_at) needsReview += 1;
    // A blank answer counts as no answer (it scored 0 automatically).
    return { question: questionOut(q, precedents), answer: given ? answerOut(a!, q) : null };
  });

  res.json({
    session: { id: session.id, status: session.status, ends_at: session.ends_at },
    quiz,
    viewer: { kind: req.staff!.kind, name: req.staff!.name },
    participant: {
      id: p.id,
      number: index + 1,
      display_name: p.display_name,
      joined_at: p.joined_at,
      submitted_at: p.submitted_at,
      submit_source: p.submit_source,
      status: participantStatus({ submitted_at: p.submitted_at, answered_count: answered, needs_review_count: needsReview }),
    },
    prev_id: index > 0 ? order[index - 1].id : null,
    next_id: index < order.length - 1 ? order[index + 1].id : null,
    gradable: p.submitted_at !== null,
    totals: { score: round1(score), max: quiz.total_points, needs_review: needsReview, answered },
    items,
  });
});

// --- Whole quiz (anonymous) -------------------------------------------------------------------

/** Stable anonymous order of a question's answers: by a hash, so never the join or answer order. */
function anonKey(sessionId: number, questionId: number, answerId: number): string {
  return createHash('sha256').update(`${sessionId}:${questionId}:${answerId}`).digest('hex');
}

gradingRouter.get('/quiz', (req: StaffRequest, res) => {
  const session = getSession(req.sessionId!)!;
  const quiz = loadQuiz(session.quiz_id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  const filter = req.query.filter === 'needs_review' ? 'needs_review' : 'all';

  const questions = loadQuestions(session.quiz_id);
  const precedents = loadPrecedents(db, session.id);
  const { not_submitted: notSubmitted, submitted } = db
    .prepare(
      `SELECT coalesce(SUM(CASE WHEN submitted_at IS NULL THEN 1 ELSE 0 END), 0) AS not_submitted,
              coalesce(SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS submitted
       FROM participants WHERE session_id = ?`,
    )
    .get(session.id) as { not_submitted: number; submitted: number };
  // Answers with whether their participant has submitted; the participant itself never leaves this function.
  const rows = db
    .prepare(
      `SELECT ${ANSWER_COLUMNS}, (p.submitted_at IS NOT NULL) AS submitted
       FROM answers a JOIN participants p ON p.id = a.participant_id
       WHERE a.session_id = ?`,
    )
    .all(session.id) as (AnswerRow & { submitted: number })[];
  const byQuestion = new Map<number, (AnswerRow & { submitted: number })[]>();
  for (const r of rows) {
    const list = byQuestion.get(r.question_id) ?? [];
    list.push(r);
    byQuestion.set(r.question_id, list);
  }

  let graded = 0;
  let total = 0;
  const out = [];
  for (const q of questions) {
    const all = byQuestion.get(q.id) ?? [];
    const answered = all.filter((a) => isAnswered(q.type, a));
    const fromSubmitted = answered
      .filter((a) => a.submitted)
      .map((a) => ({ a, key: anonKey(session.id, q.id, a.id) }))
      .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))
      .map(({ a }, i) => ({ a, label: i + 1 }));
    const needsReview = fromSubmitted.filter(({ a }) => q.type === 'text' && a.points_awarded == null).length;
    if (q.type === 'text') {
      total += fromSubmitted.length;
      graded += fromSubmitted.length - needsReview;
    }

    const stats: Record<string, unknown> = {
      answered: fromSubmitted.length,
      correct: fromSubmitted.filter(({ a }) => a.points_awarded != null && a.is_correct === 1).length,
      needs_review: needsReview,
      awaiting_submission: q.type === 'text' ? answered.filter((a) => !a.submitted && a.points_awarded == null).length : 0,
      no_answer: Math.max(0, submitted - fromSubmitted.length),
      not_submitted_participants: notSubmitted,
    };
    if (q.type === 'text') stats.rule_matched = fromSubmitted.filter(({ a }) => a.grade_source === 'rule').length;
    if (q.type !== 'text') {
      const counts: Record<number, number> = {};
      for (const c of q.choices) counts[c.id] = 0;
      for (const { a } of fromSubmitted) for (const id of parseIds(a.selected_choice_ids)) counts[id] = (counts[id] ?? 0) + 1;
      stats.choice_counts = counts;
    }

    if (filter === 'needs_review' && (q.type !== 'text' || needsReview === 0)) continue;
    const shown = filter === 'needs_review' ? fromSubmitted.filter(({ a }) => a.points_awarded == null) : fromSubmitted;
    out.push({
      question: questionOut(q, precedents),
      stats,
      answers: shown.map(({ a, label }) => ({ label, ...answerOut(a, q) })),
    });
  }

  res.json({
    session: { id: session.id, status: session.status, started_at: session.started_at, ends_at: session.ends_at },
    quiz,
    viewer: { kind: req.staff!.kind, name: req.staff!.name },
    filter,
    progress: { graded, total },
    questions: out,
  });
});

const IDS_MAX = 200;

/**
 * The current grade of some answers of this session, for a refresh after grading:changed: the open
 * whole-quiz list updates just the rows that changed instead of reloading every answer. Grade fields
 * and the AI suggestion only (no participant, no answer text).
 */
gradingRouter.get('/answers', (req: StaffRequest, res) => {
  const ids = String(req.query.ids ?? '')
    .split(',')
    .filter((s) => s.trim() !== '')
    .map(Number);
  if (ids.length === 0 || ids.length > IDS_MAX || !ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
    return res.status(400).json({ error: `ids must be 1–${IDS_MAX} answer ids, comma-separated` });
  }
  const answers = (
    db
      .prepare(
        `SELECT ${ANSWER_GRADE_COLUMNS}, ${AI_ANSWER_FIELDS.join(', ')} FROM answers WHERE session_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
      )
      .all(req.sessionId!, ...ids) as (Record<string, unknown> & AnswerRow)[]
  ).map((a) => ({ ...a, ...aiFieldsOf(a) }));
  res.json({ answers });
});

// --- Grading writes ---------------------------------------------------------------------------

function sendGradeError(res: Response, r: Exclude<GradeResult, { ok: true }>) {
  switch (r.error) {
    case 'not_found':
      return res.status(404).json({ error: 'Answer not found in this session', code: 'NOT_FOUND' });
    case 'invalid_points':
      return res
        .status(400)
        .json({ error: `points_awarded must be a whole or half number between 0 and ${r.max}`, code: 'INVALID_POINTS', max: r.max });
    case 'not_submitted':
      return res.status(409).json({ error: 'not_submitted', code: 'NOT_SUBMITTED' });
    case 'conflict':
      return res.status(409).json({ error: 'conflict', code: 'CONFLICT', current: r.current });
  }
}

/** The shared part of a grade body: verdict, points and the source ('ai' = an accepted AI suggestion, wish 7). */
function readVerdict(body: any): { isCorrect: boolean; points: number; source: 'ai' | 'human' } | string {
  if (typeof body?.is_correct !== 'boolean') return 'is_correct must be true or false';
  if (typeof body?.points_awarded !== 'number' || !Number.isFinite(body.points_awarded)) return 'points_awarded must be a number';
  if (body.source !== undefined && body.source !== 'human' && body.source !== 'ai') return 'source must be "human" or "ai"';
  return { isCorrect: body.is_correct, points: body.points_awarded, source: body.source === 'ai' ? 'ai' : 'human' };
}

const isVersion = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

gradingRouter.put('/answers/:answerId', (req: StaffRequest, res) => {
  const verdict = readVerdict(req.body);
  if (typeof verdict === 'string') return res.status(400).json({ error: verdict });
  if (!isVersion(req.body?.expected_version)) return res.status(400).json({ error: 'expected_version must be a whole number' });
  const staff = req.staff!;
  const actor = staffLabel(staff);
  const r = gradeAnswer(db, req.sessionId!, {
    answerId: Number(req.params.answerId),
    isCorrect: verdict.isCorrect,
    points: verdict.points,
    expectedVersion: req.body.expected_version,
    actor,
    linkId: staff.kind === 'grader' ? staff.linkId : null,
    source: verdict.source,
  });
  if (!r.ok) return sendGradeError(res, r);
  broadcastGradingChanged(req.sessionId!, { kind: 'grade', answerIds: [r.answer.id], by: actor });
  res.json({ answer: r.answer });
});

const BULK_MAX = 500;

/** Group grading of identical answers (S13 builds on it): one transaction, one result per item. */
gradingRouter.post('/answers/bulk-grade', (req: StaffRequest, res) => {
  const verdict = readVerdict(req.body);
  if (typeof verdict === 'string') return res.status(400).json({ error: verdict });
  const items = req.body?.items;
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    items.length > BULK_MAX ||
    !items.every((it) => Number.isSafeInteger(it?.answer_id) && isVersion(it?.expected_version))
  ) {
    return res.status(400).json({ error: `items must be 1–${BULK_MAX} entries of {answer_id, expected_version}` });
  }
  const staff = req.staff!;
  const actor = staffLabel(staff);
  const results = db.transaction(() =>
    (items as { answer_id: number; expected_version: number }[]).map((it) => {
      const r = gradeAnswer(db, req.sessionId!, {
        answerId: it.answer_id,
        isCorrect: verdict.isCorrect,
        points: verdict.points,
        expectedVersion: it.expected_version,
        actor,
        linkId: staff.kind === 'grader' ? staff.linkId : null,
        source: verdict.source,
      });
      if (r.ok) return { id: it.answer_id, ok: true as const, answer: r.answer };
      return { id: it.answer_id, ok: false as const, error: r.error, ...('current' in r ? { current: r.current } : {}) };
    }),
  )();
  const changed = results.filter((r) => r.ok).map((r) => r.id);
  if (changed.length > 0) broadcastGradingChanged(req.sessionId!, { kind: 'grade', answerIds: changed, by: actor });
  res.json({ results });
});
