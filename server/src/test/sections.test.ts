import './env';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { db } from '../db';
import { runMigrations } from '../db/migrate';
import { backfillSeededSections } from '../db/chidonSections';
import { CHIDON_5786_TITLE, CHIDON_5787_ANFAENGER_TITLE, CHIDON_5787_FORTGESCHRITTENE_TITLE } from '../db/quizTitles';
import { CONTENT_LANGS } from '../lib/languages';
import { createAdmin, createQuizFixture, findKeys, join, login, request, startServer, type QuizFixture } from './helpers';

// Rubrics (wish 10, step S11): schema, the Chidon backfill, the rubric endpoints and what participants get.

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8');
// schema.sql as it was before S11: without the quiz_sections table and its index.
const PRE_S11_SCHEMA = SCHEMA.replace(
  /CREATE TABLE IF NOT EXISTS quiz_sections \([\s\S]*?\);\s*CREATE INDEX IF NOT EXISTS idx_sections_quiz[^;]*;/,
  '',
);

/** What a boot does: schema.sql, then the migrations (Render boots run this twice: seed, then start). */
function boot(d: Database.Database) {
  d.exec(SCHEMA);
  runMigrations(d);
}

/** A database from before S11 with Chidon-shaped quizzes (base columns only). */
function legacyDb(): Database.Database {
  assert.ok(!PRE_S11_SCHEMA.includes('quiz_sections'), 'the S11 block was cut from schema.sql');
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  d.exec(PRE_S11_SCHEMA);
  d.prepare("INSERT INTO admins (username, password_hash) VALUES ('admin', 'x')").run();
  const insertQuiz = d.prepare('INSERT INTO quizzes (title, time_limit_seconds, created_by) VALUES (?, 600, 1)');
  const insertQuestion = d.prepare('INSERT INTO questions (quiz_id, sort_order, type, text, image_path) VALUES (?, ?, ?, ?, ?)');
  const insertChoice = d.prepare('INSERT INTO choices (question_id, text, is_correct, sort_order) VALUES (?, ?, ?, ?)');
  const addQuestions = (quizId: number, specs: { type: string; choices: number; image?: boolean }[]) =>
    specs.forEach((spec, i) => {
      const qId = Number(insertQuestion.run(quizId, i, spec.type, `Q${i + 1}`, spec.image ? '/uploads/p.jpeg' : null).lastInsertRowid);
      for (let c = 0; c < spec.choices; c++) insertChoice.run(qId, `C${c}`, c === 0 ? 1 : 0, c);
    });
  const repeat = <T>(n: number, v: T) => Array.from({ length: n }, () => v);

  const chidon = Number(insertQuiz.run(CHIDON_5786_TITLE).lastInsertRowid);
  addQuestions(chidon, [
    ...repeat(5, { type: 'single', choices: 2 }),
    ...repeat(15, { type: 'single', choices: 4 }),
    ...repeat(10, { type: 'text', choices: 0 }),
    ...repeat(20, { type: 'text', choices: 0, image: true }),
  ]);
  for (const title of [CHIDON_5787_ANFAENGER_TITLE, CHIDON_5787_FORTGESCHRITTENE_TITLE]) {
    const id = Number(insertQuiz.run(title).lastInsertRowid);
    addQuestions(id, [...repeat(20, { type: 'single', choices: 4 }), ...repeat(10, { type: 'text', choices: 0 })]);
  }
  const other = Number(insertQuiz.run('Another quiz').lastInsertRowid);
  addQuestions(other, [{ type: 'single', choices: 2 }, { type: 'text', choices: 0 }]);
  return d;
}

function quizIdByTitle(d: Database.Database, title: string): number {
  return (d.prepare('SELECT id FROM quizzes WHERE title = ?').get(title) as { id: number }).id;
}

/** Rubric names of a quiz in order, with the number of questions in each. */
function rubrics(d: Database.Database, quizId: number) {
  return d
    .prepare(
      `SELECT s.name, s.sort_order, (SELECT COUNT(*) FROM questions q WHERE q.section_id = s.id) AS questions
       FROM quiz_sections s WHERE s.quiz_id = ? ORDER BY s.sort_order, s.id`,
    )
    .all(quizId) as { name: string; sort_order: number; questions: number }[];
}

/** Everything the migrations could touch. */
function dump(d: Database.Database) {
  return {
    master: d.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all(),
    sections: d.prepare('SELECT * FROM quiz_sections ORDER BY id').all(),
    questions: d.prepare('SELECT id, quiz_id, sort_order, section_id FROM questions ORDER BY id').all(),
    quizzes: d.prepare('SELECT * FROM quizzes ORDER BY id').all(),
  };
}

describe('migration and Chidon backfill', () => {
  test('a pre-S11 database gets the table, the column, the index and the seeded rubrics', () => {
    const d = legacyDb();
    boot(d);

    const columns = (table: string) => (d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    assert.ok(columns('questions').includes('section_id'));
    for (const l of CONTENT_LANGS) assert.ok(columns('quiz_sections').includes(`name_${l}`), `name_${l}`);
    assert.ok(d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_questions_section'").get());
    const fk = d.prepare('PRAGMA foreign_key_list(questions)').all() as { table: string; from: string; on_delete: string }[];
    assert.ok(fk.some((k) => k.table === 'quiz_sections' && k.from === 'section_id' && k.on_delete === 'SET NULL'));

    const chidon = quizIdByTitle(d, CHIDON_5786_TITLE);
    assert.deepEqual(rubrics(d, chidon), [
      { name: 'True / False', sort_order: 0, questions: 5 },
      { name: 'Multiple choice', sort_order: 1, questions: 15 },
      { name: 'Open questions', sort_order: 2, questions: 10 },
      { name: 'Picture questions', sort_order: 3, questions: 20 },
    ]);
    // Contiguous: 1–5, 6–20, 21–30, 31–50.
    const order = (d.prepare('SELECT s.sort_order AS r FROM questions q JOIN quiz_sections s ON s.id = q.section_id WHERE q.quiz_id = ? ORDER BY q.sort_order').all(chidon) as { r: number }[]).map((x) => x.r);
    assert.deepEqual(order, [...Array(5).fill(0), ...Array(15).fill(1), ...Array(10).fill(2), ...Array(20).fill(3)]);

    const tf = d.prepare('SELECT * FROM quiz_sections WHERE quiz_id = ? AND sort_order = 0').get(chidon) as Record<string, string | null>;
    assert.equal(tf.name_de, 'Richtig / Falsch');
    assert.equal(tf.name_ru, 'Верно / Неверно');
    assert.equal(tf.name_he, 'נכון / לא נכון');
    assert.equal(tf.name_lt, 'Teisinga / Neteisinga');
    assert.equal(tf.name_uk, 'Правда / Неправда');
    assert.equal(tf.name_fr, null);
    assert.equal(tf.name_pl, null);
    assert.match(String(tf.created_at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    const picture = d.prepare('SELECT name_de, name_ru, name_he FROM quiz_sections WHERE quiz_id = ? AND sort_order = 3').get(chidon);
    assert.deepEqual(picture, { name_de: 'Bildfragen', name_ru: 'Вопросы по картинке', name_he: 'שאלות על תמונה' });

    for (const title of [CHIDON_5787_ANFAENGER_TITLE, CHIDON_5787_FORTGESCHRITTENE_TITLE]) {
      const id = quizIdByTitle(d, title);
      assert.deepEqual(rubrics(d, id), [
        { name: 'Teil A: Single-Choice-Fragen', sort_order: 0, questions: 20 },
        { name: 'Teil B: Offene Fragen', sort_order: 1, questions: 10 },
      ]);
      const translated = d.prepare(`SELECT COUNT(*) AS n FROM quiz_sections WHERE quiz_id = ? AND (${CONTENT_LANGS.map((l) => `name_${l} IS NOT NULL`).join(' OR ')})`).get(id) as { n: number };
      assert.equal(translated.n, 0, 'German-only quiz: names in the base column only');
    }

    const other = quizIdByTitle(d, 'Another quiz');
    assert.deepEqual(rubrics(d, other), []);
    assert.equal((d.prepare('SELECT COUNT(*) AS n FROM questions WHERE quiz_id = ? AND section_id IS NOT NULL').get(other) as { n: number }).n, 0);
  });

  test('running the migrations again changes nothing; author edits survive later boots', () => {
    const d = legacyDb();
    boot(d);
    const first = dump(d);
    boot(d);
    boot(d);
    assert.deepEqual(dump(d), first);
    backfillSeededSections(d);
    assert.deepEqual(dump(d), first);
    assert.equal((d.prepare('SELECT COUNT(*) AS n FROM quiz_sections').get() as { n: number }).n, 8);

    // The author renames a rubric and moves a question out of it: the next boot keeps both.
    const chidon = quizIdByTitle(d, CHIDON_5786_TITLE);
    d.prepare("UPDATE quiz_sections SET name = 'Richtig oder falsch' WHERE quiz_id = ? AND sort_order = 0").run(chidon);
    d.prepare('UPDATE questions SET section_id = NULL WHERE quiz_id = ? AND sort_order = 0').run(chidon);
    const edited = dump(d);
    boot(d);
    assert.deepEqual(dump(d), edited);

    // Deleting all rubrics of a seeded quiz brings them back on the next boot (documented).
    const anfaenger = quizIdByTitle(d, CHIDON_5787_ANFAENGER_TITLE);
    d.prepare('DELETE FROM quiz_sections WHERE quiz_id = ?').run(anfaenger);
    assert.equal((d.prepare('SELECT COUNT(*) AS n FROM questions WHERE quiz_id = ? AND section_id IS NOT NULL').get(anfaenger) as { n: number }).n, 0);
    boot(d);
    assert.deepEqual(rubrics(d, anfaenger).map((r) => r.questions), [20, 10]);
  });

  test('a fresh database: migrations before the quizzes exist do nothing, the seed-time call adds the rubrics', () => {
    const d = new Database(':memory:');
    d.pragma('foreign_keys = ON');
    boot(d);
    assert.equal((d.prepare('SELECT COUNT(*) AS n FROM quiz_sections').get() as { n: number }).n, 0);
    d.prepare("INSERT INTO admins (username, password_hash) VALUES ('admin', 'x')").run();
    const quizId = Number(d.prepare('INSERT INTO quizzes (title, time_limit_seconds, created_by) VALUES (?, 60, 1)').run(CHIDON_5787_FORTGESCHRITTENE_TITLE).lastInsertRowid);
    d.prepare("INSERT INTO questions (quiz_id, sort_order, type, text) VALUES (?, 0, 'text', 'Frage')").run(quizId);
    backfillSeededSections(d);
    backfillSeededSections(d);
    assert.deepEqual(rubrics(d, quizId).map((r) => r.questions), [0, 1]);
  });
});

/** Every `name_<lang>` key, empty unless given: the editor always sends all 14. */
function names(name: string, given: Record<string, string> = {}): Record<string, string> {
  return { name, ...Object.fromEntries(CONTENT_LANGS.map((l) => [`name_${l}`, given[l] ?? ''])) };
}

/** Every `text_<lang>` key, empty. */
function texts(): Record<string, string> {
  return Object.fromEntries(CONTENT_LANGS.map((l) => [`text_${l}`, '']));
}

describe('rubric endpoints', () => {
  let base = '';
  let close: () => Promise<void>;
  let adminId: number;
  let token: string;
  let fx: QuizFixture;
  let other: QuizFixture;

  before(async () => {
    ({ base, close } = await startServer());
    adminId = createAdmin();
    token = await login(base);
    fx = createQuizFixture(adminId, 'Rubric quiz');
    other = createQuizFixture(adminId, 'Other rubric quiz');
  });

  after(async () => {
    await close();
  });

  const sectionsOf = (quizId: number) =>
    db.prepare('SELECT id, name, name_de, name_ru, sort_order FROM quiz_sections WHERE quiz_id = ? ORDER BY sort_order, id').all(quizId) as {
      id: number;
      name: string;
      name_de: string | null;
      name_ru: string | null;
      sort_order: number;
    }[];
  const sectionOfQuestion = (id: number) => (db.prepare('SELECT section_id FROM questions WHERE id = ?').get(id) as { section_id: number | null }).section_id;

  let alpha: number;
  let beta: number;
  let foreign: number;

  test('create: a name is required; translations are stored; new rubrics go to the end', async () => {
    assert.equal((await request(base, 'POST', `/api/quizzes/${fx.quizId}/sections`, token, names('   '))).status, 400);
    assert.equal((await request(base, 'POST', `/api/quizzes/${fx.quizId}/sections`, token, {})).status, 400);
    assert.equal((await request(base, 'POST', `/api/quizzes/${fx.quizId}/sections`, token, names('x'.repeat(201)))).status, 400);
    assert.equal((await request(base, 'POST', '/api/quizzes/999999/sections', token, names('Nope'))).status, 404);

    const r1 = await request(base, 'POST', `/api/quizzes/${fx.quizId}/sections`, token, names('  Alpha ', { de: 'Alpha DE' }));
    assert.equal(r1.status, 201);
    assert.equal(r1.body.quiz.sections.length, 1);
    assert.equal(r1.body.quiz.sections[0].name, 'Alpha');
    assert.equal(r1.body.quiz.sections[0].name_de, 'Alpha DE');
    const r2 = await request(base, 'POST', `/api/quizzes/${fx.quizId}/sections`, token, names('Beta'));
    assert.equal(r2.status, 201);
    [alpha, beta] = sectionsOf(fx.quizId).map((s) => s.id);
    assert.deepEqual(sectionsOf(fx.quizId).map((s) => [s.name, s.sort_order]), [['Alpha', 0], ['Beta', 1]]);
    // The admin payload carries every question's section_id.
    assert.ok(r2.body.quiz.questions.every((q: { section_id: unknown }) => q.section_id === null));

    const r3 = await request(base, 'POST', `/api/quizzes/${other.quizId}/sections`, token, names('Foreign'));
    foreign = r3.body.quiz.sections[0].id;
  });

  test('rename replaces the name and all translations', async () => {
    const r = await request(base, 'PUT', `/api/sections/${alpha}`, token, names('Alpha 2', { ru: 'Альфа' }));
    assert.equal(r.status, 200);
    assert.equal(r.body.quiz.id, fx.quizId);
    assert.deepEqual(sectionsOf(fx.quizId)[0], { id: alpha, name: 'Alpha 2', name_de: null, name_ru: 'Альфа', sort_order: 0 });
    assert.equal((await request(base, 'PUT', `/api/sections/${alpha}`, token, names(''))).status, 400);
    assert.equal((await request(base, 'PUT', '/api/sections/999999', token, names('Ghost'))).status, 404);
    assert.equal(sectionsOf(fx.quizId)[0].name, 'Alpha 2');
  });

  test('reorder needs exactly the quiz\'s rubric ids and is atomic', async () => {
    const before = sectionsOf(fx.quizId);
    for (const orderedIds of [[alpha], [alpha, beta, foreign], [alpha, foreign], [alpha, alpha], 'x', [String(alpha), String(beta)]]) {
      const r = await request(base, 'PUT', `/api/quizzes/${fx.quizId}/sections/reorder`, token, { orderedIds });
      assert.equal(r.status, 400, JSON.stringify(orderedIds));
    }
    assert.deepEqual(sectionsOf(fx.quizId), before);
    const r = await request(base, 'PUT', `/api/quizzes/${fx.quizId}/sections/reorder`, token, { orderedIds: [beta, alpha] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.quiz.sections.map((s: { id: number }) => s.id), [beta, alpha]);
    assert.deepEqual(sectionsOf(fx.quizId).map((s) => [s.id, s.sort_order]), [[beta, 0], [alpha, 1]]);
  });

  test('question create: a rubric of another quiz is refused; an own rubric is stored', async () => {
    const body = { type: 'text', text: 'New one', points: 1, choices: [], ...texts() };
    const bad = await request(base, 'POST', `/api/quizzes/${fx.quizId}/questions`, token, { ...body, section_id: foreign });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body, { error: 'section does not belong to this quiz' });
    for (const section_id of ['1', 0, -3, 1.5, true]) {
      assert.equal((await request(base, 'POST', `/api/quizzes/${fx.quizId}/questions`, token, { ...body, section_id })).status, 400);
    }
    const ok = await request(base, 'POST', `/api/quizzes/${fx.quizId}/questions`, token, { ...body, section_id: alpha });
    assert.equal(ok.status, 201);
    const created = ok.body.quiz.questions.find((q: { text: string }) => q.text === 'New one');
    assert.equal(created.section_id, alpha);
    const none = await request(base, 'POST', `/api/quizzes/${fx.quizId}/questions`, token, { ...body, text: 'No rubric' });
    assert.equal(none.body.quiz.questions.find((q: { text: string }) => q.text === 'No rubric').section_id, null);
  });

  test('question edit: absent key keeps the rubric, null clears it, a foreign one is refused', async () => {
    const body = { type: 'text', text: 'Explain gravity.', points: 2, choices: [], ...texts() };
    const put = (extra: object) => request(base, 'PUT', `/api/questions/${fx.textQuestionId}`, token, { ...body, ...extra });
    assert.equal((await put({ section_id: beta })).status, 200);
    assert.equal(sectionOfQuestion(fx.textQuestionId), beta);
    assert.equal((await put({})).status, 200);
    assert.equal(sectionOfQuestion(fx.textQuestionId), beta, 'no key: unchanged');
    const bad = await put({ section_id: foreign });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'section does not belong to this quiz');
    assert.equal(sectionOfQuestion(fx.textQuestionId), beta, 'a refused edit changes nothing');
    assert.equal((await put({ section_id: 'beta' })).status, 400);
    assert.equal((await put({ section_id: null })).status, 200);
    assert.equal(sectionOfQuestion(fx.textQuestionId), null);
    assert.equal((await put({ section_id: alpha })).status, 200);
    assert.equal(sectionOfQuestion(fx.textQuestionId), alpha);
  });

  test('participants get rubric names and section_id, nothing else', async () => {
    db.prepare('UPDATE questions SET section_id = ? WHERE id = ?').run(beta, fx.singleQuestionId);
    const joined = await join(base, fx.joinCode, 'Rubric Kid');
    assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, token)).status, 200);
    const r = await request(base, 'GET', '/api/my/quiz', joined.body.token);
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.body.sections.map((s: { id: number }) => s.id),
      [beta, alpha],
    );
    const allowed = ['id', 'name', ...CONTENT_LANGS.map((l) => `name_${l}`), 'sort_order'].sort();
    for (const s of r.body.sections) assert.deepEqual(Object.keys(s).sort(), allowed);
    assert.equal(r.body.sections[1].name_ru, 'Альфа');
    const byId = new Map(r.body.questions.map((q: { id: number; section_id: number | null }) => [q.id, q.section_id]));
    assert.equal(byId.get(fx.singleQuestionId), beta);
    assert.equal(byId.get(fx.textQuestionId), alpha);
    assert.deepEqual(findKeys(r.body, ['is_correct', 'points_awarded', 'content_languages', 'quiz_id']).filter((k) => k.startsWith('$.sections')), []);
    assert.deepEqual(findKeys(r.body, ['is_correct', 'points_awarded', 'content_languages']), []);
  });

  test('delete: the questions stay without a rubric, the rest is renumbered', async () => {
    assert.equal((await request(base, 'DELETE', '/api/sections/999999', token)).status, 404);
    const r = await request(base, 'DELETE', `/api/sections/${beta}`, token);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.quiz.sections.map((s: { id: number; sort_order: number }) => [s.id, s.sort_order]), [[alpha, 0]]);
    assert.equal(sectionOfQuestion(fx.singleQuestionId), null);
    assert.equal(sectionOfQuestion(fx.textQuestionId), alpha);
    assert.ok(db.prepare('SELECT 1 FROM questions WHERE id = ?').get(fx.singleQuestionId), 'the question itself stays');
  });

  test('ON DELETE: a deleted rubric row clears section_id; a deleted quiz takes its rubrics along', () => {
    const quizId = Number(db.prepare("INSERT INTO quizzes (title, time_limit_seconds, created_by) VALUES ('Cascade', 60, ?)").run(adminId).lastInsertRowid);
    const sectionId = Number(db.prepare("INSERT INTO quiz_sections (quiz_id, name, sort_order, created_at) VALUES (?, 'S', 0, 'x')").run(quizId).lastInsertRowid);
    const questionId = Number(db.prepare("INSERT INTO questions (quiz_id, sort_order, type, text, section_id) VALUES (?, 0, 'text', 'Q', ?)").run(quizId, sectionId).lastInsertRowid);
    db.prepare('DELETE FROM quiz_sections WHERE id = ?').run(sectionId);
    assert.equal(sectionOfQuestion(questionId), null);
    db.prepare("INSERT INTO quiz_sections (quiz_id, name, sort_order, created_at) VALUES (?, 'T', 0, 'x')").run(quizId);
    db.prepare('DELETE FROM quizzes WHERE id = ?').run(quizId);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM quiz_sections WHERE quiz_id = ?').get(quizId) as { n: number }).n, 0);
  });
});
