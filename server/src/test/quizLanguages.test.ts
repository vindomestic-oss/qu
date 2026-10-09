import './env';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate';
import { getQuizLanguageInfo, invalidateQuizLanguages } from '../lib/quizLanguages';
import { CHIDON_5787_ANFAENGER_TITLE } from '../db/quizTitles';

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8');

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  runMigrations(db);
  db.prepare("INSERT INTO admins (username, password_hash) VALUES ('admin', 'x')").run();
  return db;
}

let db: Database.Database;
let quizId: number;

function quiz(base = 'en') {
  return { id: quizId, base_language: base };
}

/** Adds a question; `langs` get a translation on the question and each choice. */
function addQuestion(type: 'single' | 'text', langs: string[], choiceLangs: string[][] = []) {
  const qCols = ['quiz_id', 'sort_order', 'type', 'text', ...langs.map((l) => `text_${l}`)];
  const qId = Number(
    db
      .prepare(`INSERT INTO questions (${qCols.join(', ')}) VALUES (${qCols.map(() => '?').join(', ')})`)
      .run(quizId, 0, type, 'Q', ...langs.map((l) => `Q-${l}`)).lastInsertRowid,
  );
  choiceLangs.forEach((cl, i) => {
    const cCols = ['question_id', 'text', 'is_correct', 'sort_order', ...cl.map((l) => `text_${l}`)];
    db.prepare(`INSERT INTO choices (${cCols.join(', ')}) VALUES (${cCols.map(() => '?').join(', ')})`).run(
      qId,
      `C${i}`,
      i === 0 ? 1 : 0,
      i,
      ...cl.map((l) => `C${i}-${l}`),
    );
  });
  return qId;
}

beforeEach(() => {
  db = freshDb();
  quizId = Number(db.prepare("INSERT INTO quizzes (title, time_limit_seconds, created_by) VALUES ('T', 60, 1)").run().lastInsertRowid);
  invalidateQuizLanguages();
});

test('a quiz without questions offers only its base language', () => {
  assert.deepEqual(getQuizLanguageInfo(db, quiz()).offered, ['en']);
});

test('only complete translations are offered, and missing texts are counted', () => {
  addQuestion('single', ['de', 'fr'], [['de', 'fr'], ['de']]);
  const info = getQuizLanguageInfo(db, quiz());
  assert.deepEqual(info.offered, ['en', 'de']);
  assert.equal(info.missing_by_language.fr, 1);
  assert.equal(info.total, 3);
});

test('whitespace-only translations count as missing', () => {
  const qId = addQuestion('text', ['de']);
  db.prepare("UPDATE questions SET text_de = '   ' WHERE id = ?").run(qId);
  assert.deepEqual(getQuizLanguageInfo(db, quiz()).offered, ['en']);
});

test('a text question counts only its own text; stray choices are ignored', () => {
  addQuestion('text', ['ru'], [[]]);
  assert.deepEqual(getQuizLanguageInfo(db, quiz()).offered, ['en', 'ru']);
});

test('the offered list follows LANGUAGE_DISPLAY_ORDER', () => {
  addQuestion('text', ['uk', 'ru', 'he', 'de', 'cs']);
  assert.deepEqual(getQuizLanguageInfo(db, quiz()).offered, ['en', 'de', 'he', 'ru', 'cs', 'uk']);
});

test('a German base quiz without translations offers only German, never English', () => {
  addQuestion('single', [], [[], []]);
  assert.deepEqual(getQuizLanguageInfo(db, quiz('de')).offered, ['de']);
});

test('results are memoised until invalidated', () => {
  const qId = addQuestion('text', ['de']);
  assert.deepEqual(getQuizLanguageInfo(db, quiz()).offered, ['en', 'de']);
  db.prepare('UPDATE questions SET text_de = NULL WHERE id = ?').run(qId);
  assert.deepEqual(getQuizLanguageInfo(db, quiz()).offered, ['en', 'de']);
  invalidateQuizLanguages(quizId);
  assert.deepEqual(getQuizLanguageInfo(db, quiz()).offered, ['en']);
});

test('migrations run twice are a no-op; the 5787 backfill runs only when base_language is added', () => {
  const legacy = new Database(':memory:');
  legacy.pragma('foreign_keys = ON');
  // schema.sql alone is a database from before base_language existed (the column comes from migrate.ts).
  legacy.exec(SCHEMA);
  legacy.prepare("INSERT INTO admins (username, password_hash) VALUES ('admin', 'x')").run();
  legacy.prepare('INSERT INTO quizzes (title, time_limit_seconds, created_by) VALUES (?, 60, 1)').run(CHIDON_5787_ANFAENGER_TITLE);
  legacy.prepare("INSERT INTO quizzes (title, time_limit_seconds, created_by) VALUES ('Other', 60, 1)").run();
  runMigrations(legacy);
  const bases = () =>
    (legacy.prepare('SELECT title, base_language FROM quizzes ORDER BY id').all() as { base_language: string }[]).map(
      (r) => r.base_language,
    );
  assert.deepEqual(bases(), ['de', 'en']);
  legacy.prepare("UPDATE quizzes SET base_language = 'en' WHERE title = ?").run(CHIDON_5787_ANFAENGER_TITLE);
  const schemaBefore = legacy.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  runMigrations(legacy);
  assert.deepEqual(bases(), ['en', 'en']);
  assert.deepEqual(legacy.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all(), schemaBefore);
});
