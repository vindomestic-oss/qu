import type Database from 'better-sqlite3';
import { CONTENT_LANGS, ContentLang, isContentLang, isQuizLang, LANGUAGE_DISPLAY_ORDER, QuizLang, translationLangs } from './languages';

// Imports only better-sqlite3 types and ./languages, never '../db' (that module opens quiz.db on import).

export interface QuizLanguageInfo {
  base_language: QuizLang;
  /** Languages the author declared for this quiz (quizzes.content_languages): base first, display order. */
  content_languages: QuizLang[];
  /** Languages a participant may pick: the base plus every declared, complete translation, in display order. */
  offered: QuizLang[];
  /** Per translation language: how many question/choice texts are still empty. */
  missing_by_language: Record<ContentLang, number>;
  /** Number of texts a complete translation needs (questions + choices of non-text questions). */
  total: number;
}

const MEMO_MS = 10_000;
const memo = new Map<number, { at: number; key: string; info: QuizLanguageInfo }>();
const countStatements = new WeakMap<Database.Database, Database.Statement>();
const usedStatements = new WeakMap<Database.Database, Database.Statement>();

function countStatement(db: Database.Database): Database.Statement {
  let stmt = countStatements.get(db);
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
    countStatements.set(db, stmt);
  }
  return stmt;
}

function usedStatement(db: Database.Database): Database.Statement {
  let stmt = usedStatements.get(db);
  if (!stmt) {
    // One 0/1 column per language; column names come from the CONTENT_LANGS whitelist only.
    const filled = (col: string) => `trim(coalesce(${col}, '')) <> ''`;
    const exprs = CONTENT_LANGS.map(
      (l) => `(EXISTS (SELECT 1 FROM quizzes WHERE id = @quizId AND (${filled(`title_${l}`)} OR ${filled(`description_${l}`)}))
        OR EXISTS (SELECT 1 FROM questions WHERE quiz_id = @quizId AND ${filled(`text_${l}`)})
        OR EXISTS (SELECT 1 FROM choices c JOIN questions q ON q.id = c.question_id
                   WHERE q.quiz_id = @quizId AND ${filled(`c.text_${l}`)})) AS ${l}`,
    );
    stmt = db.prepare(`SELECT ${exprs.join(', ')}`);
    usedStatements.set(db, stmt);
  }
  return stmt;
}

/**
 * Validates a declared-language list: an array of strings whose non-base entries are all
 * translation languages (ContentLang). Returns it deduplicated, base first, the rest in
 * LANGUAGE_DISPLAY_ORDER; null when the input is invalid. The base is added when missing.
 */
export function normalizeQuizLanguages(input: unknown, base: QuizLang): QuizLang[] | null {
  if (!Array.isArray(input) || input.some((v) => typeof v !== 'string')) return null;
  const rest = new Set<QuizLang>();
  for (const code of input as string[]) {
    if (code === base) continue;
    if (!isContentLang(code)) return null;
    rest.add(code);
  }
  return [base, ...LANGUAGE_DISPLAY_ORDER.filter((l) => l !== base && rest.has(l))];
}

/** quizzes.content_languages as stored (a JSON array), normalised; null when absent or invalid. */
export function parseStoredLanguages(raw: unknown, base: QuizLang): QuizLang[] | null {
  if (typeof raw !== 'string') return null;
  try {
    return normalizeQuizLanguages(JSON.parse(raw), base);
  } catch {
    return null;
  }
}

/**
 * The base plus every translation language that has any non-blank text in this quiz (title,
 * description, a question or a choice), in display order. Used for the backfill and as the
 * fallback when a quiz has no stored list.
 */
export function computeUsedLanguages(db: Database.Database, quizId: number, base: QuizLang): QuizLang[] {
  const row = usedStatement(db).get({ quizId }) as Record<ContentLang, number>;
  const used = new Set<QuizLang>(translationLangs(base).filter((l) => row[l] === 1));
  return [base, ...LANGUAGE_DISPLAY_ORDER.filter((l) => l !== base && used.has(l))];
}

/**
 * Offered = base + every DECLARED language whose translation is complete (decision
 * Q-partial-languages): a participant never lands on a half-translated question, and a language
 * the author removed ("×") is hidden even when its texts are complete. Memoised per quiz for 10 s,
 * because waiting rooms poll /my/session every few seconds. Callers select base_language and
 * content_languages.
 */
export function getQuizLanguageInfo(
  db: Database.Database,
  quiz: { id: number; base_language: string; content_languages?: string | null },
): QuizLanguageInfo {
  const key = `${quiz.base_language}|${quiz.content_languages ?? ''}`;
  const cached = memo.get(quiz.id);
  if (cached && cached.key === key && Date.now() - cached.at < MEMO_MS) return cached.info;

  const base: QuizLang = isQuizLang(quiz.base_language) ? quiz.base_language : 'en';
  const declared = parseStoredLanguages(quiz.content_languages, base) ?? computeUsedLanguages(db, quiz.id, base);
  const row = countStatement(db).get({ quizId: quiz.id }) as Record<string, number> & { total: number };
  const missing = {} as Record<ContentLang, number>;
  for (const l of CONTENT_LANGS) missing[l] = row[l];
  // declared[0] is the base; the rest are ContentLangs (normalised), so English is offered only as the base.
  const offered: QuizLang[] = [
    base,
    ...declared.filter((l) => l !== base && isContentLang(l) && row.total > 0 && missing[l] === 0),
  ];
  const info: QuizLanguageInfo = {
    base_language: base,
    content_languages: declared,
    offered,
    missing_by_language: missing,
    total: row.total,
  };
  memo.set(quiz.id, { at: Date.now(), key, info });
  return info;
}

/** Call after every write that can change a quiz's texts or languages; without an id, clears everything. */
export function invalidateQuizLanguages(quizId?: number): void {
  if (quizId === undefined) memo.clear();
  else memo.delete(quizId);
}
