import type Database from 'better-sqlite3';
import { CONTENT_LANGS } from './languages';
import { extractTranslations, type Translations } from './questionInput';
import { translationColumns, translationValues } from './sqlTranslations';
import { nowIso } from './time';

// Rubrics (quiz_sections, wish 10). Imports only better-sqlite3 types and lib modules, never '../db'.

export const MAX_SECTION_NAME_LENGTH = 200;
export const SECTION_NOT_IN_QUIZ = 'section does not belong to this quiz';

export interface SectionInput {
  name: string;
  /** All 14 `name_<lang>`; an absent or blank key is stored as NULL (the editor always sends all). */
  translations: Translations;
}

/** `{ name, name_de, …, name_uk }` from a request body; a trimmed, non-empty name is required. */
export function parseSectionInput(body: any): SectionInput | { error: string } {
  const name = body?.name;
  if (typeof name !== 'string' || !name.trim()) return { error: 'name is required' };
  const translations = extractTranslations(body, 'name');
  const tooLong = [name.trim(), ...CONTENT_LANGS.map((l) => translations[l] ?? '')].some(
    (v) => v.length > MAX_SECTION_NAME_LENGTH,
  );
  if (tooLong) return { error: `a rubric name can have at most ${MAX_SECTION_NAME_LENGTH} characters` };
  return { name: name.trim(), translations };
}

export function sectionBelongsToQuiz(db: Database.Database, sectionId: number, quizId: number): boolean {
  return Boolean(db.prepare('SELECT 1 FROM quiz_sections WHERE id = ? AND quiz_id = ?').get(sectionId, quizId));
}

/** Adds a rubric at the end of the quiz's list and returns its id. */
export function createSection(db: Database.Database, quizId: number, input: SectionInput): number {
  const columns = ['quiz_id', 'name', ...translationColumns('name'), 'sort_order', 'created_at'];
  return Number(
    db
      .prepare(
        `INSERT INTO quiz_sections (${columns.join(', ')})
         VALUES (?, ?, ${translationColumns('name').map(() => '?').join(', ')},
                 (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM quiz_sections WHERE quiz_id = ?), ?)`,
      )
      .run(quizId, input.name, ...translationValues(input.translations), quizId, nowIso()).lastInsertRowid,
  );
}

/** Renames a rubric (base name and every translation). False when it does not exist. */
export function updateSection(db: Database.Database, sectionId: number, input: SectionInput): boolean {
  const sets = ['name = ?', ...translationColumns('name').map((c) => `${c} = ?`)];
  return (
    db
      .prepare(`UPDATE quiz_sections SET ${sets.join(', ')} WHERE id = ?`)
      .run(input.name, ...translationValues(input.translations), sectionId).changes > 0
  );
}

/**
 * Deletes a rubric in one transaction. Its questions stay, without a rubric (also done explicitly,
 * not only through ON DELETE SET NULL); the remaining rubrics are renumbered 0..n-1, so the colours
 * follow the visible order. Returns the quiz id, or null when the rubric does not exist.
 */
export function deleteSection(db: Database.Database, sectionId: number): number | null {
  return db.transaction(() => {
    const row = db.prepare('SELECT quiz_id FROM quiz_sections WHERE id = ?').get(sectionId) as { quiz_id: number } | undefined;
    if (!row) return null;
    db.prepare('UPDATE questions SET section_id = NULL WHERE section_id = ?').run(sectionId);
    db.prepare('DELETE FROM quiz_sections WHERE id = ?').run(sectionId);
    const rest = db.prepare('SELECT id FROM quiz_sections WHERE quiz_id = ? ORDER BY sort_order, id').all(row.quiz_id) as {
      id: number;
    }[];
    const setOrder = db.prepare('UPDATE quiz_sections SET sort_order = ? WHERE id = ?');
    rest.forEach((s, i) => setOrder.run(i, s.id));
    return row.quiz_id;
  })();
}

/**
 * Puts the quiz's rubrics in the given order, atomically. `orderedIds` must be exactly the quiz's
 * rubric ids; returns an error message otherwise and changes nothing.
 */
export function reorderSections(db: Database.Database, quizId: number, orderedIds: unknown): string | null {
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => !Number.isSafeInteger(id))) {
    return 'orderedIds must be an array of rubric ids';
  }
  const existing = (db.prepare('SELECT id FROM quiz_sections WHERE quiz_id = ?').all(quizId) as { id: number }[]).map((s) => s.id);
  const sameSet = existing.length === orderedIds.length && new Set(orderedIds).size === orderedIds.length && existing.every((id) => orderedIds.includes(id));
  if (!sameSet) return "orderedIds must match the quiz's current rubric ids exactly";
  db.transaction(() => {
    const stmt = db.prepare('UPDATE quiz_sections SET sort_order = ? WHERE id = ? AND quiz_id = ?');
    (orderedIds as number[]).forEach((id, index) => stmt.run(index, id, quizId));
  })();
  return null;
}
