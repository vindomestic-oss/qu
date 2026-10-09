import Database from 'better-sqlite3';
import { CONTENT_LANGS } from '../lib/languages';

const ADDED_COLUMNS: Record<string, { name: string; type: string }[]> = {
  // ISO time; admin tokens issued before it are rejected (set on creation and on every password change).
  admins: [{ name: 'tokens_valid_after', type: 'TEXT' }],
  quizzes: [
    ...CONTENT_LANGS.map((lang) => ({ name: `title_${lang}`, type: 'TEXT' })),
    ...CONTENT_LANGS.map((lang) => ({ name: `description_${lang}`, type: 'TEXT' })),
    { name: 'base_language', type: "TEXT NOT NULL DEFAULT 'en'" },
  ],
  questions: CONTENT_LANGS.map((lang) => ({ name: `text_${lang}`, type: 'TEXT' })),
  choices: CONTENT_LANGS.map((lang) => ({ name: `text_${lang}`, type: 'TEXT' })),
  participants: [
    // NULL means the participant hasn't clicked "Finish" yet; set once, never cleared.
    { name: 'submitted_at', type: 'TEXT' },
    // sha256 hex of the participant's rejoin secret; NULL = the name can be claimed (legacy row or "Allow rejoin").
    { name: 'rejoin_hash', type: 'TEXT' },
    // Raised whenever the row is claimed again; participant tokens carry it, so older tokens stop working.
    { name: 'token_version', type: 'INTEGER NOT NULL DEFAULT 0' },
  ],
};

// Quizzes whose questions are written directly in a non-English base language. Backfilled into
// quizzes.base_language the one time that column is added to an existing database (see below);
// freshly seeded quizzes set it themselves on insert instead.
const NON_ENGLISH_BASE_QUIZZES: Record<string, string> = {
  'Chidon HaTanach 5787 – Anfänger (München)': 'de',
  'Chidon HaTanach 5787 – Fortgeschrittene (München)': 'de',
};

/** Adds columns introduced after a table already existed. CREATE TABLE IF NOT EXISTS in schema.sql only covers fresh databases. */
export function runMigrations(db: Database.Database) {
  let baseLanguageJustAdded = false;
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    const existing = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    for (const col of columns) {
      if (!existing.has(col.name)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.type}`);
        if (table === 'quizzes' && col.name === 'base_language') baseLanguageJustAdded = true;
      }
    }
  }

  if (baseLanguageJustAdded) {
    const setBaseLanguage = db.prepare('UPDATE quizzes SET base_language = ? WHERE title = ?');
    for (const [title, lang] of Object.entries(NON_ENGLISH_BASE_QUIZZES)) {
      setBaseLanguage.run(lang, title);
    }
  }

  // Blank text answers submitted before auto-scoring was added were left pending
  // (points_awarded IS NULL) for manual grading; backfill them to 0 now that they don't need review.
  db.exec(`
    UPDATE answers SET points_awarded = 0, is_correct = 0
    WHERE points_awarded IS NULL
      AND (text_answer IS NULL OR trim(text_answer) = '')
      AND question_id IN (SELECT id FROM questions WHERE type = 'text')
  `);
}
