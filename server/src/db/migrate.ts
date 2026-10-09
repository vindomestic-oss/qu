import Database from 'better-sqlite3';
import { CONTENT_LANGS, isQuizLang } from '../lib/languages';
import { computeUsedLanguages } from '../lib/quizLanguages';
import { CHIDON_5787_ANFAENGER_TITLE, CHIDON_5787_FORTGESCHRITTENE_TITLE } from './quizTitles';
import { backfillSeededSections } from './chidonSections';
import { CHIDON_ANSWER_KEYS } from './chidonAnswerKey';

const ADDED_COLUMNS: Record<string, { name: string; type: string }[]> = {
  // ISO time; admin tokens issued before it are rejected (set on creation and on every password change).
  admins: [{ name: 'tokens_valid_after', type: 'TEXT' }],
  quizzes: [
    ...CONTENT_LANGS.map((lang) => ({ name: `title_${lang}`, type: 'TEXT' })),
    ...CONTENT_LANGS.map((lang) => ({ name: `description_${lang}`, type: 'TEXT' })),
    { name: 'base_language', type: "TEXT NOT NULL DEFAULT 'en'" },
    // JSON array of the languages the author declared (base first, then display order); NULL until
    // backfilled below. Participants are offered only declared languages that are complete.
    { name: 'content_languages', type: 'TEXT' },
    // Points a new question starts with in the editor (integers and halves).
    { name: 'default_points', type: 'REAL NOT NULL DEFAULT 1' },
  ],
  questions: [
    ...CONTENT_LANGS.map((lang) => ({ name: `text_${lang}`, type: 'TEXT' })),
    // The question's rubric (S11); NULL = none. Deleting the rubric keeps the question.
    { name: 'section_id', type: 'INTEGER REFERENCES quiz_sections(id) ON DELETE SET NULL' },
    // Text questions only (NULL for choice types); for graders, never in participant payloads.
    { name: 'reference_answer', type: 'TEXT' },
    // JSON array of accepted variants (≤ 30 strings ≤ 120 chars); filled by the answer-key backfill,
    // edited and used for matching from S13.
    { name: 'accepted_answers', type: 'TEXT' },
    { name: 'grader_notes', type: 'TEXT' },
  ],
  choices: CONTENT_LANGS.map((lang) => ({ name: `text_${lang}`, type: 'TEXT' })),
  participants: [
    // NULL means the participant hasn't clicked "Finish" yet; set once, never cleared.
    { name: 'submitted_at', type: 'TEXT' },
    // sha256 hex of the participant's rejoin secret; NULL = the name can be claimed (legacy row or "Allow rejoin").
    { name: 'rejoin_hash', type: 'TEXT' },
    // Raised whenever the row is claimed again; participant tokens carry it, so older tokens stop working.
    { name: 'token_version', type: 'INTEGER NOT NULL DEFAULT 0' },
    // Who submitted: 'participant' (Finish) or 'session_end' (the session ended first).
    { name: 'submit_source', type: 'TEXT' },
  ],
  // 1 = new names cannot join (host's "Lock joining"); people already in the session can still rejoin.
  sessions: [{ name: 'joining_locked', type: 'INTEGER NOT NULL DEFAULT 0' }],
  // Rubric names in the translation languages (the table itself is in schema.sql).
  quiz_sections: CONTENT_LANGS.map((lang) => ({ name: `name_${lang}`, type: 'TEXT' })),
  answers: [
    // 'auto_choice' | 'auto_blank' | 'rule' | 'ai_confirmed' | 'ai_auto' | 'human' (validated in TypeScript).
    { name: 'grade_source', type: 'TEXT' },
    // Display string of the grader, e.g. 'admin:alex' or 'Rav K. (link #3)'.
    { name: 'graded_by', type: 'TEXT' },
    // grader_links.id of the grader (S12); no foreign key on purpose.
    { name: 'graded_by_link_id', type: 'INTEGER' },
    // Optimistic concurrency for grading: every write to the answer or its grade raises it.
    { name: 'grade_version', type: 'INTEGER NOT NULL DEFAULT 0' },
  ],
};

// Quizzes whose questions are written directly in a non-English base language. Backfilled into
// quizzes.base_language only in the boot that adds that column (it is NOT NULL, so an IS NULL guard
// cannot tell); freshly seeded quizzes set it themselves on insert.
const NON_ENGLISH_BASE_QUIZZES: Record<string, string> = {
  [CHIDON_5787_ANFAENGER_TITLE]: 'de',
  [CHIDON_5787_FORTGESCHRITTENE_TITLE]: 'de',
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

  // Ended sessions count as submitted by the session end (they can be graded at once). Guarded by IS NULL.
  db.exec(`
    UPDATE participants
    SET submitted_at = (SELECT coalesce(s.ends_at, s.created_at) FROM sessions s WHERE s.id = participants.session_id),
        submit_source = 'session_end'
    WHERE submitted_at IS NULL AND session_id IN (SELECT id FROM sessions WHERE status = 'ended')
  `);
  db.exec(`UPDATE participants SET submit_source = 'participant' WHERE submitted_at IS NOT NULL AND submit_source IS NULL`);

  // Where each existing grade came from, in this order; every step only touches rows still NULL.
  db.exec(`
    UPDATE answers SET grade_source = 'auto_choice'
    WHERE grade_source IS NULL AND question_id IN (SELECT id FROM questions WHERE type <> 'text')
  `);
  db.exec(`
    UPDATE answers SET grade_source = 'auto_blank'
    WHERE grade_source IS NULL AND trim(coalesce(text_answer, '')) = ''
      AND question_id IN (SELECT id FROM questions WHERE type = 'text')
  `);
  db.exec(`
    UPDATE answers SET grade_source = 'human'
    WHERE grade_source IS NULL AND graded_at IS NOT NULL AND points_awarded IS NOT NULL
      AND question_id IN (SELECT id FROM questions WHERE type = 'text')
  `);
  // A text answer re-saved after grading lost its points but kept graded_at; that stamp is stale.
  db.exec('UPDATE answers SET graded_at = NULL WHERE points_awarded IS NULL AND graded_at IS NOT NULL');

  // Blank text answers submitted before auto-scoring was added were left pending
  // (points_awarded IS NULL) for manual grading; backfill them to 0 now that they don't need review.
  db.exec(`
    UPDATE answers SET points_awarded = 0, is_correct = 0
    WHERE points_awarded IS NULL
      AND (text_answer IS NULL OR trim(text_answer) = '')
      AND question_id IN (SELECT id FROM questions WHERE type = 'text')
  `);

  // Declared languages of existing quizzes = the languages they already have text in. Runs after the
  // base_language backfill (the base decides which columns count); guarded by IS NULL, so later
  // boots change nothing and a list the author edited is never overwritten.
  const undeclared = db.prepare('SELECT id, base_language FROM quizzes WHERE content_languages IS NULL').all() as {
    id: number;
    base_language: string;
  }[];
  if (undeclared.length > 0) {
    const setDeclared = db.prepare('UPDATE quizzes SET content_languages = ? WHERE id = ?');
    db.transaction(() => {
      for (const q of undeclared) {
        const base = isQuizLang(q.base_language) ? q.base_language : 'en';
        setDeclared.run(JSON.stringify(computeUsedLanguages(db, q.id, base)), q.id);
      }
    })();
  }

  // Indexes on columns added above (schema.sql runs before they exist on old databases).
  db.exec('CREATE INDEX IF NOT EXISTS idx_questions_section ON questions(section_id)');
  // Rubrics of the seeded Chidon quizzes; skips quizzes that already have any (later boots: no-op).
  backfillSeededSections(db);
  const filled = backfillAnswerKeys(db);
  if (filled.some((n) => n > 0)) {
    console.log(`Chidon answer keys filled: ${CHIDON_ANSWER_KEYS.map((k, i) => `${k.name} ${filled[i]}`).join(', ')}`);
  }
}

/**
 * Model answers of the seeded Chidon quizzes (chidonAnswerKey.ts) for text questions that have none
 * yet, matched by the exact question text. Guarded by IS NULL: a later boot, or an answer the author
 * edited, is never overwritten. Returns the rows filled per key (30 / 10 / 10 on a database holding
 * all three quizzes the first time, then 0 / 0 / 0).
 */
export function backfillAnswerKeys(db: Database.Database): number[] {
  const fill = db.prepare(
    `UPDATE questions SET reference_answer = ?, accepted_answers = ?, grader_notes = coalesce(grader_notes, ?)
     WHERE type = 'text' AND text = ? AND reference_answer IS NULL`,
  );
  return db.transaction(() =>
    CHIDON_ANSWER_KEYS.map(({ entries }) =>
      entries.reduce((n, e) => n + fill.run(e.reference, JSON.stringify(e.accepted), e.notes ?? null, e.text).changes, 0),
    ),
  )();
}
