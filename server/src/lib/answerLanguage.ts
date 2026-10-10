import type Database from 'better-sqlite3';
import { isQuizLang, type QuizLang } from './languages';
import { parseStoredLanguages } from './quizLanguages';

// Wish 8 (S15, an extra): answers.answer_lang, a tag for graders ("RU", "DE" next to an answer) and
// the key of the panel's per-language statistics. Never sent to participants.
//
// What it holds, decided by the server at save time:
//   - the language the question was shown in when the participant saved the answer (the client
//     sends it as `lang`; accepted only when it is one of the quiz's offered languages);
//   - for a free-text answer, corrected by the script the answer is written in: when most of its
//     letters are Hebrew, Cyrillic or Latin and that script does not fit the shown language (a
//     question read in German, answered in Hebrew), the language is the quiz language written in
//     that script (base first, then the offered order), else Hebrew → he, Cyrillic → ru, Latin → en.
//     The script decides only between scripts: de and en (or ru and uk) are never guessed from text.
//   - NULL when nothing is known (a choice answer saved without `lang`, a blank answer, an answer of
//     digits only saved without `lang`).
// Answers saved before S15 have no shown language: text answers are backfilled from their script
// alone (Latin → the quiz's base when it is written in Latin); choice answers stay NULL.

export type Script = 'hebrew' | 'cyrillic' | 'latin';

// Letters only (\p{L}): niqqud and other combining marks never outweigh the letters of another script.
const SCRIPTS: { script: Script; re: RegExp }[] = [
  { script: 'hebrew', re: /(?=\p{L})\p{Script=Hebrew}/gu },
  { script: 'cyrillic', re: /(?=\p{L})\p{Script=Cyrillic}/gu },
  { script: 'latin', re: /(?=\p{L})\p{Script=Latin}/gu },
];

/** The script most of the text's letters are written in; null without Hebrew, Cyrillic or Latin letters. */
export function detectScript(text: string): Script | null {
  let best: Script | null = null;
  let bestCount = 0;
  for (const { script, re } of SCRIPTS) {
    const n = text.match(re)?.length ?? 0;
    if (n > bestCount) {
      best = script;
      bestCount = n;
    }
  }
  return best;
}

const CYRILLIC_LANGS: ReadonlySet<QuizLang> = new Set(['ru', 'uk', 'bg']);
const SCRIPT_DEFAULT: Record<Script, QuizLang> = { hebrew: 'he', cyrillic: 'ru', latin: 'en' };

export function scriptOfLanguage(lang: QuizLang): Script {
  if (lang === 'he') return 'hebrew';
  return CYRILLIC_LANGS.has(lang) ? 'cyrillic' : 'latin';
}

/** The client's `lang` when it is one of the quiz's offered languages; otherwise null. */
export function shownLanguage(raw: unknown, offered: readonly QuizLang[]): QuizLang | null {
  return isQuizLang(raw) && offered.includes(raw) ? raw : null;
}

/** answers.answer_lang for a save (see the top of this file). `text` is null for a choice answer. */
export function answerLanguage(input: {
  text: string | null;
  shown: QuizLang | null;
  base: QuizLang;
  languages: readonly QuizLang[];
}): QuizLang | null {
  const { text, shown, base, languages } = input;
  if (text === null) return shown;
  if (text.trim() === '') return null;
  const script = detectScript(text);
  if (script === null) return shown;
  if (shown !== null && scriptOfLanguage(shown) === script) return shown;
  return [base, ...languages].find((l) => scriptOfLanguage(l) === script) ?? SCRIPT_DEFAULT[script];
}

/**
 * answer_lang of non-blank text answers saved before S15, from their script (no shown language is
 * known), in one transaction. Guarded by IS NULL; an answer without letters stays NULL, so a second
 * run writes nothing.
 */
export function backfillAnswerLanguages(db: Database.Database): number {
  const rows = db
    .prepare(
      `SELECT a.id, a.text_answer, z.base_language, z.content_languages
       FROM answers a JOIN questions q ON q.id = a.question_id JOIN quizzes z ON z.id = q.quiz_id
       WHERE a.answer_lang IS NULL AND q.type = 'text' AND trim(coalesce(a.text_answer, '')) <> ''`,
    )
    .all() as { id: number; text_answer: string; base_language: string; content_languages: string | null }[];
  if (rows.length === 0) return 0;
  const set = db.prepare('UPDATE answers SET answer_lang = ? WHERE id = ? AND answer_lang IS NULL');
  return db.transaction(() =>
    rows.reduce((n, r) => {
      const base: QuizLang = isQuizLang(r.base_language) ? r.base_language : 'en';
      const languages = parseStoredLanguages(r.content_languages, base) ?? [base];
      const lang = answerLanguage({ text: r.text_answer, shown: null, base, languages });
      return lang === null ? n : n + set.run(lang, r.id).changes;
    }, 0),
  )();
}
