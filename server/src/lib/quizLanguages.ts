import type Database from 'better-sqlite3';
import { CONTENT_LANGS, ContentLang, isQuizLang, LANGUAGE_DISPLAY_ORDER, QuizLang } from './languages';

// Imports only better-sqlite3 types and ./languages, never '../db' (that module opens quiz.db on import).

export interface QuizLanguageInfo {
  base_language: QuizLang;
  /** Languages a participant may pick: the base plus every complete translation, in display order. */
  offered: QuizLang[];
  /** Per translation language: how many question/choice texts are still empty. */
  missing_by_language: Record<ContentLang, number>;
  /** Number of texts a complete translation needs (questions + choices of non-text questions). */
  total: number;
}

const MEMO_MS = 10_000;
const memo = new Map<number, { at: number; key: string; info: QuizLanguageInfo }>();
const statements = new WeakMap<Database.Database, Database.Statement>();

function countStatement(db: Database.Database): Database.Statement {
  let stmt = statements.get(db);
  if (!stmt) {
    // Built only from the CONTENT_LANGS whitelist. Choices of text questions are ignored (never shown).
    const cols = (prefix: string) => CONTENT_LANGS.map((l) => `${prefix}text_${l}`).join(', ');
    const sums = CONTENT_LANGS.map(
      (l) => `COALESCE(SUM(CASE WHEN text_${l} IS NULL OR trim(text_${l}) = '' THEN 1 ELSE 0 END), 0) AS ${l}`,
    ).join(', ');
    stmt = db.prepare(
      `SELECT COUNT(*) AS total, ${sums}
       FROM (SELECT ${cols('')} FROM questions WHERE quiz_id = @quizId
             UNION ALL
             SELECT ${cols('c.')} FROM choices c JOIN questions q ON q.id = c.question_id
             WHERE q.quiz_id = @quizId AND q.type <> 'text')`,
    );
    statements.set(db, stmt);
  }
  return stmt;
}

function parseDeclared(raw: string | null | undefined): QuizLang[] | null {
  if (raw === null || raw === undefined) return null;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(isQuizLang) : null;
  } catch {
    return null;
  }
}

/**
 * Offered = base + every declared language whose translation is complete (decision
 * Q-partial-languages): a participant never lands on a half-translated question. Memoised per
 * quiz for 10 s, because waiting rooms poll /my/session every few seconds.
 */
export function getQuizLanguageInfo(
  db: Database.Database,
  quiz: { id: number; base_language: string; content_languages?: string | null },
): QuizLanguageInfo {
  const key = `${quiz.base_language}|${quiz.content_languages ?? ''}`;
  const cached = memo.get(quiz.id);
  if (cached && cached.key === key && Date.now() - cached.at < MEMO_MS) return cached.info;

  const base: QuizLang = isQuizLang(quiz.base_language) ? quiz.base_language : 'en';
  const declared = parseDeclared(quiz.content_languages);
  const row = countStatement(db).get({ quizId: quiz.id }) as Record<string, number> & { total: number };
  const missing = {} as Record<ContentLang, number>;
  for (const l of CONTENT_LANGS) missing[l] = row[l];
  // There is no text_en column, so English is offered only as the base.
  const offered: QuizLang[] = [
    base,
    ...LANGUAGE_DISPLAY_ORDER.filter(
      (l) =>
        l !== base && l !== 'en' && row.total > 0 && missing[l as ContentLang] === 0 && (!declared || declared.includes(l)),
    ),
  ];
  const info: QuizLanguageInfo = { base_language: base, offered, missing_by_language: missing, total: row.total };
  memo.set(quiz.id, { at: Date.now(), key, info });
  return info;
}

/** Call after every write that can change a quiz's texts; without an id, clears everything. */
export function invalidateQuizLanguages(quizId?: number): void {
  if (quizId === undefined) memo.clear();
  else memo.delete(quizId);
}
