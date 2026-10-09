import type Database from 'better-sqlite3';
import { getQuizLanguageInfo, parseStoredLanguages } from './quizLanguages';
import { isQuizLang, QuizLang } from './languages';
import { hasSeededRubrics } from '../db/chidonSections';

// Imports only better-sqlite3 types, lib modules and db/chidonSections (which takes db as a
// parameter), never '../db' (that module opens quiz.db on import).
// Admin payloads only: participants get explicit column lists from lib/participantColumns.ts.

// Rows selected with `SELECT *` also carry title_de/text_ru/etc. translation columns (see lib/languages.ts).
interface QuizRow {
  id: number;
  base_language: string;
  content_languages: string | null;
  [column: string]: unknown;
}

interface QuestionRow {
  id: number;
  type: string;
  [column: string]: unknown;
}

/** The base language of a quiz row, guarded against unexpected stored values. */
export function baseOf(row: { base_language?: unknown }): QuizLang {
  return isQuizLang(row.base_language) ? row.base_language : 'en';
}

/** quizzes.content_languages of a list row as an array (the base alone when nothing is stored). */
export function declaredLanguagesOf(row: { base_language?: unknown; content_languages?: unknown }): QuizLang[] {
  const base = baseOf(row);
  return parseStoredLanguages(row.content_languages, base) ?? [base];
}

/**
 * The admin editor's view of a quiz: every quiz column, its rubrics (`sections`, in order), its
 * questions with choices (in order, each with its section_id), and the language fields as parsed
 * arrays: content_languages (declared), offered_languages (what participants see) and
 * missing_by_language. The only copy of this function.
 */
export function getQuizWithQuestions(db: Database.Database, quizId: number) {
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(quizId) as QuizRow | undefined;
  if (!quiz) return null;
  const info = getQuizLanguageInfo(db, quiz);

  const sections = db.prepare('SELECT * FROM quiz_sections WHERE quiz_id = ? ORDER BY sort_order, id').all(quizId);
  const questions = db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY sort_order').all(quizId) as QuestionRow[];
  const choiceStmt = db.prepare('SELECT * FROM choices WHERE question_id = ? ORDER BY sort_order');
  const questionsWithChoices = questions.map((q) => ({
    ...q,
    choices: q.type === 'text' ? [] : choiceStmt.all(q.id),
  }));

  return {
    ...quiz,
    base_language: info.base_language,
    content_languages: info.content_languages,
    offered_languages: info.offered,
    missing_by_language: info.missing_by_language,
    sections,
    // The seeded Chidon quizzes get their standard rubrics back on the next boot once all are deleted.
    seeded_rubrics: hasSeededRubrics(db, quiz),
    questions: questionsWithChoices,
  };
}
