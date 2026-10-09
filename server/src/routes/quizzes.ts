import { Router } from 'express';
import { db } from '../db';
import { requireAdmin, AuthedRequest } from '../middleware/jwt';
import { parseQuestionInput, extractTranslations } from '../lib/questionInput';
import { deleteImageFile } from '../lib/uploads';
import { createUniqueJoinCode, getSession, refreshSessionStatus, SessionRow } from '../lib/sessions';
import { translationColumns, translationValues } from '../lib/sqlTranslations';
import { CONTENT_LANGS, isContentLang, isQuizLang, QuizLang, translationLangs } from '../lib/languages';
import {
  computeUsedLanguages,
  invalidateQuizLanguages,
  normalizeQuizLanguages,
  parseStoredLanguages,
} from '../lib/quizLanguages';
import { baseOf, declaredLanguagesOf, getQuizWithQuestions as loadQuiz } from '../lib/quizPayload';
import { createSection, parseSectionInput, reorderSections, SECTION_NOT_IN_QUIZ, sectionBelongsToQuiz } from '../lib/sections';

export const quizzesRouter = Router();

const MAX_TIME_LIMIT_SECONDS = 7 * 24 * 60 * 60;
quizzesRouter.use(requireAdmin);

function getQuizWithQuestions(quizId: number) {
  return loadQuiz(db, quizId);
}

/** The stored declared list of a quiz, or the languages it has text in when nothing is stored yet. */
function declaredLanguages(quizId: number, base: QuizLang, raw: unknown): QuizLang[] {
  return parseStoredLanguages(raw, base) ?? computeUsedLanguages(db, quizId, base);
}

// --- Quizzes ---

quizzesRouter.get('/', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT q.*, (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) as question_count,
         (SELECT s.id FROM sessions s WHERE s.quiz_id = q.id AND s.status IN ('pending', 'active') ORDER BY s.id DESC LIMIT 1)
           AS open_session_id
       FROM quizzes q ORDER BY q.created_at DESC`,
    )
    .all() as (Record<string, unknown> & { open_session_id: number | null })[];
  // getSession applies the lazy expiry, so a run whose time is up is not shown as open.
  const quizzes = rows.map(({ open_session_id, ...quiz }) => {
    const s = open_session_id ? getSession(open_session_id) : null;
    return {
      ...quiz,
      content_languages: declaredLanguagesOf(quiz),
      open_session:
        s && s.status !== 'ended'
          ? { id: s.id, status: s.status, join_code: s.join_code, ends_at: s.ends_at, joining_locked: s.joining_locked }
          : null,
    };
  });
  res.json({ quizzes });
});

quizzesRouter.post('/', (req: AuthedRequest, res) => {
  const { title, description, time_limit_seconds, base_language } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const timeLimit = Number(time_limit_seconds);
  if (!Number.isFinite(timeLimit) || timeLimit <= 0 || timeLimit > MAX_TIME_LIMIT_SECONDS) {
    return res.status(400).json({ error: 'time_limit_seconds must be between 1 second and 7 days' });
  }
  const baseLanguage = base_language === undefined || base_language === null ? 'en' : base_language;
  if (!isQuizLang(baseLanguage)) {
    return res.status(400).json({ error: `base_language must be one of: en, ${CONTENT_LANGS.join(', ')}` });
  }

  const titleTranslations = extractTranslations(req.body, 'title');
  const descriptionTranslations = extractTranslations(req.body, 'description');
  // Declared from the start: the base plus every language whose title or description was filled in.
  const contentLanguages = normalizeQuizLanguages(
    [baseLanguage, ...translationLangs(baseLanguage).filter((l) => titleTranslations[l] || descriptionTranslations[l])],
    baseLanguage,
  );
  const columns = [
    'title',
    ...translationColumns('title'),
    'description',
    ...translationColumns('description'),
    'time_limit_seconds',
    'created_by',
    'base_language',
    'content_languages',
  ];
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
      baseLanguage,
      JSON.stringify(contentLanguages ?? [baseLanguage]),
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
  const existing = db.prepare('SELECT id, base_language, content_languages FROM quizzes WHERE id = ?').get(quizId) as
    | { id: number; base_language: string; content_languages: string | null }
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Quiz not found' });

  const { title, description, time_limit_seconds, base_language } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const timeLimit = Number(time_limit_seconds);
  if (!Number.isFinite(timeLimit) || timeLimit <= 0 || timeLimit > MAX_TIME_LIMIT_SECONDS) {
    return res.status(400).json({ error: 'time_limit_seconds must be between 1 second and 7 days' });
  }
  const baseLanguage = base_language === undefined || base_language === null ? existing.base_language : base_language;
  if (!isQuizLang(baseLanguage)) {
    return res.status(400).json({ error: `base_language must be one of: en, ${CONTENT_LANGS.join(', ')}` });
  }

  const titleTranslations = extractTranslations(req.body, 'title');
  const descriptionTranslations = extractTranslations(req.body, 'description');
  const setClauses = [
    'title = ?',
    ...translationColumns('title').map((c) => `${c} = ?`),
    'description = ?',
    ...translationColumns('description').map((c) => `${c} = ?`),
    'time_limit_seconds = ?',
    'base_language = ?',
  ];
  const values: unknown[] = [
    title.trim(),
    ...translationValues(titleTranslations),
    description ?? null,
    ...translationValues(descriptionTranslations),
    timeLimit,
    baseLanguage,
  ];
  const oldBase = baseOf(existing);
  db.transaction(() => {
    const declared = declaredLanguages(quizId, oldBase, existing.content_languages);
    db.prepare(`UPDATE quizzes SET ${setClauses.join(', ')} WHERE id = ?`).run(...values, quizId);
    if (baseLanguage === oldBase) return;
    // Only a change of the main language changes the declared list: the new base goes first. The old
    // base stays only when it is a translation language that has text in its own translation columns
    // (en -> de -> en keeps the German translations offered); English has no such columns, and a
    // German-only quiz keeps its German in the base fields.
    const keepOldBase = isContentLang(oldBase) && computeUsedLanguages(db, quizId, baseLanguage).includes(oldBase);
    const next = normalizeQuizLanguages(
      [baseLanguage, ...declared.filter((l) => l !== oldBase && l !== baseLanguage), ...(keepOldBase ? [oldBase] : [])],
      baseLanguage,
    );
    db.prepare('UPDATE quizzes SET content_languages = ? WHERE id = ?').run(JSON.stringify(next ?? [baseLanguage]), quizId);
  })();
  invalidateQuizLanguages(quizId);

  res.json({ quiz: getQuizWithQuestions(quizId) });
});

// Declares which languages the quiz has (editor: "+ Add language" and "×"). Replaces the whole list
// and never touches any text: a removed language's translations stay and come back when it is re-added.
quizzesRouter.put('/:id/languages', (req, res) => {
  const quizId = Number(req.params.id);
  const quiz = db.prepare('SELECT id, base_language FROM quizzes WHERE id = ?').get(quizId) as
    | { id: number; base_language: string }
    | undefined;
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const normalized = normalizeQuizLanguages(req.body?.content_languages, baseOf(quiz));
  if (!normalized) {
    return res.status(400).json({ error: 'content_languages must be an array of supported language codes' });
  }
  db.prepare('UPDATE quizzes SET content_languages = ? WHERE id = ?').run(JSON.stringify(normalized), quizId);
  invalidateQuizLanguages(quizId);
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
  invalidateQuizLanguages(quizId);
  res.status(204).end();
});

// --- Questions (nested under a quiz) ---

quizzesRouter.post('/:id/questions', (req, res) => {
  const quizId = Number(req.params.id);
  const quiz = db.prepare('SELECT id, base_language, content_languages FROM quizzes WHERE id = ?').get(quizId) as
    | { id: number; base_language: string; content_languages: string | null }
    | undefined;
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  // Choice ids in this body are ignored: every choice of a new question is new.
  const parsed = parseQuestionInput(req.body);
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });
  if (parsed.section_id != null && !sectionBelongsToQuiz(db, parsed.section_id, quizId)) {
    return res.status(400).json({ error: SECTION_NOT_IN_QUIZ });
  }
  const base = baseOf(quiz);

  const createQuestion = db.transaction(() => {
    const { count } = db
      .prepare('SELECT COUNT(*) as count FROM questions WHERE quiz_id = ?')
      .get(quizId) as { count: number };

    const questionColumns = ['quiz_id', 'sort_order', 'type', 'text', ...translationColumns('text'), 'points', 'section_id'];
    const result = db
      .prepare(`INSERT INTO questions (${questionColumns.join(', ')}) VALUES (${questionColumns.map(() => '?').join(', ')})`)
      .run(quizId, count, parsed.type, parsed.text, ...translationValues(parsed.translations), parsed.points, parsed.section_id ?? null);
    const questionId = Number(result.lastInsertRowid);

    const choiceColumns = ['question_id', 'text', ...translationColumns('text'), 'is_correct', 'sort_order'];
    const insertChoice = db.prepare(
      `INSERT INTO choices (${choiceColumns.join(', ')}) VALUES (${choiceColumns.map(() => '?').join(', ')})`,
    );
    parsed.choices.forEach((c, i) =>
      insertChoice.run(questionId, c.text, ...translationValues(c.translations), c.is_correct ? 1 : 0, i),
    );

    // Languages this question is written in become declared, so an importer never creates
    // translations the editor and participants cannot see.
    const used = translationLangs(base).filter(
      (l) => parsed.translations[l] || parsed.choices.some((c) => c.translations[l]),
    );
    if (used.length > 0) {
      const declared = declaredLanguages(quizId, base, quiz.content_languages);
      const next = normalizeQuizLanguages([...declared, ...used], base);
      if (next) db.prepare('UPDATE quizzes SET content_languages = ? WHERE id = ?').run(JSON.stringify(next), quizId);
    }

    return questionId;
  });

  createQuestion();
  invalidateQuizLanguages(quizId);
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

// --- Rubrics (nested under a quiz; rename and delete are in routes/sections.ts) ---

quizzesRouter.post('/:id/sections', (req, res) => {
  const quizId = Number(req.params.id);
  const quiz = db.prepare('SELECT id FROM quizzes WHERE id = ?').get(quizId);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const parsed = parseSectionInput(req.body);
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });
  createSection(db, quizId, parsed);
  res.status(201).json({ quiz: getQuizWithQuestions(quizId) });
});

quizzesRouter.put('/:id/sections/reorder', (req, res) => {
  const quizId = Number(req.params.id);
  const quiz = db.prepare('SELECT id FROM quizzes WHERE id = ?').get(quizId);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const error = reorderSections(db, quizId, req.body?.orderedIds);
  if (error) return res.status(400).json({ error });
  res.json({ quiz: getQuizWithQuestions(quizId) });
});

// --- Sessions (nested under a quiz) ---

quizzesRouter.get('/:id/sessions', (req, res) => {
  const quizId = Number(req.params.id);
  const quiz = db.prepare('SELECT id FROM quizzes WHERE id = ?').get(quizId);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const rows = db
    .prepare('SELECT * FROM sessions WHERE quiz_id = ? ORDER BY id DESC')
    .all(quizId) as SessionRow[];
  const sessions = rows.map(refreshSessionStatus);
  res.json({ sessions });
});

quizzesRouter.post('/:id/sessions', (req, res) => {
  const quizId = Number(req.params.id);
  const quiz = db.prepare('SELECT id FROM quizzes WHERE id = ?').get(quizId);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  // One open run per quiz (decision Q-parallel-runs). Ordered by id: created_at has 1 s resolution.
  // A run whose time is up is ended here and a new one is created instead of returning it.
  const existing = db
    .prepare("SELECT * FROM sessions WHERE quiz_id = ? AND status IN ('pending', 'active') ORDER BY id DESC LIMIT 1")
    .get(quizId) as SessionRow | undefined;
  if (existing) {
    const current = refreshSessionStatus(existing);
    if (current.status !== 'ended') return res.json({ session: current });
  }

  const joinCode = createUniqueJoinCode();
  const result = db.prepare('INSERT INTO sessions (quiz_id, join_code) VALUES (?, ?)').run(quizId, joinCode);
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(Number(result.lastInsertRowid));
  res.status(201).json({ session });
});
