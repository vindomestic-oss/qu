import Database from 'better-sqlite3';
import { CONTENT_LANGS } from '../lib/languages';

const ADDED_COLUMNS: Record<string, { name: string; type: string }[]> = {
  quizzes: [
    ...CONTENT_LANGS.map((lang) => ({ name: `title_${lang}`, type: 'TEXT' })),
    ...CONTENT_LANGS.map((lang) => ({ name: `description_${lang}`, type: 'TEXT' })),
  ],
  questions: CONTENT_LANGS.map((lang) => ({ name: `text_${lang}`, type: 'TEXT' })),
  choices: CONTENT_LANGS.map((lang) => ({ name: `text_${lang}`, type: 'TEXT' })),
};

/** Adds columns introduced after a table already existed. CREATE TABLE IF NOT EXISTS in schema.sql only covers fresh databases. */
export function runMigrations(db: Database.Database) {
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    const existing = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    for (const col of columns) {
      if (!existing.has(col.name)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.type}`);
      }
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
