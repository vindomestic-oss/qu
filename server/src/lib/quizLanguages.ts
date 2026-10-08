import type { Database } from 'better-sqlite3';
import { CONTENT_LANGS, isQuizLang, QuizLang } from './languages';

export interface QuizLanguageInfo {
  base_language: QuizLang;
  offered_languages: QuizLang[];
}

/**
 * Languages a participant may see this quiz's questions in: the quiz's base language, plus
 * every other language where EVERY question's text and EVERY choice's text (on non-text
 * questions) has a non-empty translation. A partially translated language is never offered —
 * a participant should never land on a question that silently falls back to another language.
 */
export function getOfferedLanguages(db: Database, quizId: number, baseLanguageRaw: unknown): QuizLanguageInfo {
  const base: QuizLang = isQuizLang(baseLanguageRaw) ? baseLanguageRaw : 'en';

  const { count } = db.prepare('SELECT COUNT(*) AS count FROM questions WHERE quiz_id = ?').get(quizId) as {
    count: number;
  };
  if (count === 0) return { base_language: base, offered_languages: [base] };

  const offered: QuizLang[] = [base];
  for (const lang of CONTENT_LANGS) {
    if (lang === base) continue;
    const { missing } = db
      .prepare(
        `SELECT COUNT(*) AS missing FROM (
           SELECT text_${lang} AS t FROM questions WHERE quiz_id = ?
           UNION ALL
           SELECT c.text_${lang} AS t FROM choices c JOIN questions q ON q.id = c.question_id
           WHERE q.quiz_id = ? AND q.type <> 'text'
         ) WHERE t IS NULL OR trim(t) = ''`,
      )
      .get(quizId, quizId) as { missing: number };
    if (missing === 0) offered.push(lang);
  }

  return { base_language: base, offered_languages: offered };
}
