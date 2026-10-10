import './env';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { db } from '../db';
import { runMigrations } from '../db/migrate';
import { answerLanguage, detectScript } from '../lib/answerLanguage';
import { createAdmin, createQuizFixture, findKeys, join, login, request, startServer, type QuizFixture } from './helpers';

// Wish 8 (S15): answers.answer_lang (the shown language, corrected by a text answer's script) and the
// panel's per-language statistics. Graders and admins only.

let base = '';
let close: () => Promise<void>;
let adminId: number;
let adminToken: string;

before(async () => {
  ({ base, close } = await startServer());
  adminId = createAdmin();
  adminToken = await login(base);
});

after(async () => {
  await close();
});

/** The fixture quiz offered in en (base), de, ru and he; started; the text question keyed "Joshua". */
async function multilingualFixture(title: string): Promise<QuizFixture> {
  const fx = createQuizFixture(adminId, title);
  db.prepare(`UPDATE quizzes SET content_languages = '["en","de","he","ru"]' WHERE id = ?`).run(fx.quizId);
  for (const l of ['de', 'ru', 'he']) {
    db.prepare(`UPDATE questions SET text_${l} = text || ' (${l})' WHERE quiz_id = ?`).run(fx.quizId);
    db.prepare(`UPDATE choices SET text_${l} = text WHERE question_id = ?`).run(fx.singleQuestionId);
  }
  db.prepare(`UPDATE questions SET reference_answer = 'Joshua', accepted_answers = ?, points = 1 WHERE id = ?`).run(
    JSON.stringify(['Joshua', 'Josua', 'יהושע', 'Иисус Навин']),
    fx.textQuestionId,
  );
  assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, adminToken)).status, 200);
  return fx;
}

async function kid(fx: QuizFixture, name: string) {
  const r = await join(base, fx.joinCode, name);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { token: r.body.token as string, id: r.body.participant.id as number };
}

const langOf = (participantId: number, questionId: number) =>
  (db.prepare('SELECT answer_lang FROM answers WHERE participant_id = ? AND question_id = ?').get(participantId, questionId) as { answer_lang: string | null })
    .answer_lang;

describe('the language of an answer', () => {
  test('script: most letters decide; digits and punctuation have none', () => {
    assert.equal(detectScript('Josua'), 'latin');
    assert.equal(detectScript('יְהוֹשֻׁעַ'), 'hebrew');
    assert.equal(detectScript('Иисус Навин'), 'cyrillic');
    assert.equal(detectScript('Ägypten'), 'latin');
    assert.equal(detectScript('דוד (David)'), 'latin');
    assert.equal(detectScript('דוד המלך (David)'), 'hebrew');
    // Letters only: the niqqud of five Hebrew letters does not outweigh six Latin ones.
    assert.equal(detectScript('יְהוֹשֻׁעַ Joshua'), 'latin');
    assert.equal(detectScript('40'), null);
    assert.equal(detectScript('?!'), null);
  });

  test('shown language when the script fits, else the quiz language of the script, else he / ru / en', () => {
    const quiz = { base: 'en' as const, languages: ['en', 'de', 'ru'] as const };
    const lang = (text: string | null, shown: 'de' | 'ru' | 'en' | 'he' | null) => answerLanguage({ text, shown, ...quiz });
    assert.equal(lang('Josua', 'de'), 'de');
    assert.equal(lang('Josua', null), 'en', 'Latin without a shown language: the base');
    assert.equal(lang('Josua', 'ru'), 'en', 'Latin under a Russian question: the base (never guessed between Latin languages)');
    assert.equal(lang('Иисус Навин', 'de'), 'ru');
    assert.equal(lang('Иисус Навин', 'ru'), 'ru');
    assert.equal(lang('יהושע', 'de'), 'he', 'Hebrew is not a quiz language here: the script default');
    assert.equal(lang('40', 'de'), 'de');
    assert.equal(lang('40', null), null);
    assert.equal(lang('   ', 'de'), null, 'a blank answer has no language');
    assert.equal(lang(null, 'ru'), 'ru', 'a choice answer: the shown language');
    assert.equal(answerLanguage({ text: 'Josua', shown: null, base: 'he', languages: ['he', 'de'] }), 'de');
  });
});

describe('answer_lang on saves', () => {
  let fx: QuizFixture;

  before(async () => {
    fx = await multilingualFixture('Language quiz');
  });

  test('text answers: the shown language (offered only), corrected by the script', async () => {
    const probe = await kid(fx, 'Probe kid');
    assert.deepEqual((await request(base, 'GET', '/api/my/session', probe.token)).body.quiz.offered_languages, ['en', 'de', 'he', 'ru']);
    const cases: [string | undefined, string, string | null][] = [
      ['de', 'Josua', 'de'],
      ['de', 'יהושע', 'he'],
      ['ru', 'Иисус Навин', 'ru'],
      ['he', 'Joshua', 'en'],
      [undefined, 'Joshua', 'en'],
      [undefined, 'יהושע', 'he'],
      ['xx', 'Josua', 'en'],
      ['fr', 'Josué', 'en'],
      ['ru', '40', 'ru'],
      [undefined, '40', null],
      [{ evil: 1 } as unknown as string, 'Josua', 'en'],
    ];
    for (const [i, [lang, text, expected]] of cases.entries()) {
      const k = await kid(fx, `Text kid ${i}`);
      const r = await request(base, 'POST', `/api/my/answers/${fx.textQuestionId}`, k.token, { text_answer: text, lang });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { ok: true }, 'the save answers nothing about the language');
      assert.equal(langOf(k.id, fx.textQuestionId), expected, `${String(lang)} / ${text}`);
    }
  });

  test('a changed answer gets a new language; an unchanged re-save writes nothing', async () => {
    const k = await kid(fx, 'Changer');
    await request(base, 'POST', `/api/my/answers/${fx.textQuestionId}`, k.token, { text_answer: 'Josua', lang: 'de' });
    assert.equal(langOf(k.id, fx.textQuestionId), 'de');
    await request(base, 'POST', `/api/my/answers/${fx.textQuestionId}`, k.token, { text_answer: 'Josua', lang: 'ru' });
    assert.equal(langOf(k.id, fx.textQuestionId), 'de', 'same text: nothing written');
    await request(base, 'POST', `/api/my/answers/${fx.textQuestionId}`, k.token, { text_answer: 'Иисус', lang: 'ru' });
    assert.equal(langOf(k.id, fx.textQuestionId), 'ru');
  });

  test('choice answers: the shown language; a save without one keeps it; unknown at first', async () => {
    const k = await kid(fx, 'Choice kid');
    await request(base, 'POST', `/api/my/answers/${fx.singleQuestionId}`, k.token, { selected_choice_ids: [fx.correctChoiceId], lang: 'he' });
    assert.equal(langOf(k.id, fx.singleQuestionId), 'he');
    await request(base, 'POST', `/api/my/answers/${fx.singleQuestionId}`, k.token, { selected_choice_ids: [fx.wrongChoiceId] });
    assert.equal(langOf(k.id, fx.singleQuestionId), 'he', 'a save without lang keeps the stored language');
    await request(base, 'POST', `/api/my/answers/${fx.singleQuestionId}`, k.token, { selected_choice_ids: [fx.correctChoiceId], lang: 'ru' });
    assert.equal(langOf(k.id, fx.singleQuestionId), 'ru');
    const fresh = await kid(fx, 'Choice kid 2');
    await request(base, 'POST', `/api/my/answers/${fx.singleQuestionId}`, fresh.token, { selected_choice_ids: [fx.correctChoiceId] });
    assert.equal(langOf(fresh.id, fx.singleQuestionId), null);
  });

  test('participants never get answer_lang back', async () => {
    const k = await kid(fx, 'Curious kid');
    await request(base, 'POST', `/api/my/answers/${fx.textQuestionId}`, k.token, { text_answer: 'Josua', lang: 'de' });
    const quiz = await request(base, 'GET', '/api/my/quiz', k.token);
    assert.equal(quiz.status, 200);
    assert.deepEqual(findKeys(quiz.body, ['answer_lang', 'languages']), []);
    const session = await request(base, 'GET', '/api/my/session', k.token);
    assert.deepEqual(findKeys(session.body, ['answer_lang']), []);
    assert.equal((await request(base, 'GET', `/api/grading/${fx.sessionId}/summary`, k.token)).status, 403);
  });
});

describe('per-language statistics for graders', () => {
  let fx: QuizFixture;
  const ids: Record<string, number> = {};

  before(async () => {
    fx = await multilingualFixture('Stats quiz');
    const answers: [string, string | undefined, string][] = [
      ['A', 'de', 'Josua'],
      ['B', 'de', 'Mose'],
      ['C', 'he', 'יהושע'],
      ['D', 'ru', 'Моисей'],
      ['E', 'ru', 'Иисус Навин'],
      ['F', undefined, 'Joshua'],
    ];
    for (const [name, lang, text] of answers) {
      const k = await kid(fx, name);
      await request(base, 'POST', `/api/my/answers/${fx.textQuestionId}`, k.token, { text_answer: text, lang });
      await request(base, 'POST', `/api/my/answers/${fx.singleQuestionId}`, k.token, { selected_choice_ids: [fx.correctChoiceId], lang });
      assert.equal((await request(base, 'POST', '/api/my/submit', k.token)).status, 200);
      ids[name] = (db.prepare('SELECT id FROM answers WHERE participant_id = ? AND question_id = ?').get(k.id, fx.textQuestionId) as { id: number }).id;
    }
    // AI suggestions (S14) as the worker would leave them: B incorrect, D correct.
    const suggest = db.prepare("UPDATE answers SET ai_status = 'done', ai_verdict = ?, ai_confidence = 'high' WHERE id = ?");
    suggest.run('incorrect', ids.B);
    suggest.run('correct', ids.D);
    const grade = async (id: number, isCorrect: boolean, points: number) => {
      const v = (db.prepare('SELECT grade_version FROM answers WHERE id = ?').get(id) as { grade_version: number }).grade_version;
      const r = await request(base, 'PUT', `/api/grading/${fx.sessionId}/answers/${id}`, adminToken, {
        is_correct: isCorrect,
        points_awarded: points,
        expected_version: v,
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    };
    await grade(ids.B, false, 0); // agrees with the AI
    await grade(ids.D, false, 0); // overrides the AI
    await grade(ids.C, false, 0); // overrides the reference check
  });

  test('rows carry answer_lang for graders', async () => {
    const quiz = await request(base, 'GET', `/api/grading/${fx.sessionId}/quiz?filter=all`, adminToken);
    const text = quiz.body.questions.find((q: { question: { id: number } }) => q.question.id === fx.textQuestionId);
    const byId = new Map(text.answers.map((a: { id: number; answer_lang: string }) => [a.id, a.answer_lang]));
    assert.deepEqual(
      ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => byId.get(ids[n])),
      ['de', 'de', 'he', 'ru', 'ru', 'en'],
    );
    const choice = quiz.body.questions.find((q: { question: { id: number } }) => q.question.id === fx.singleQuestionId);
    assert.ok(choice.answers.every((a: { answer_lang: string | null }) => a.answer_lang !== undefined));
  });

  test('summary: free-text answers per language, % correct, AI and reference-check agreement', async () => {
    const r = await request(base, 'GET', `/api/grading/${fx.sessionId}/summary`, adminToken);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.languages, [
      { lang: 'en', answers: 1, graded: 1, correct: 1, ai: { agreed: 0, total: 0 }, rule: { agreed: 1, total: 1 } },
      { lang: 'de', answers: 2, graded: 2, correct: 1, ai: { agreed: 1, total: 1 }, rule: { agreed: 1, total: 1 } },
      { lang: 'he', answers: 1, graded: 1, correct: 0, ai: { agreed: 0, total: 0 }, rule: { agreed: 0, total: 1 } },
      { lang: 'ru', answers: 2, graded: 2, correct: 1, ai: { agreed: 0, total: 1 }, rule: { agreed: 1, total: 1 } },
    ]);
    assert.deepEqual(findKeys(r.body.languages, ['text_answer', 'answer_norm', 'participant_id', 'display_name']), []);
  });

  test('a session without submitted free-text answers has no language rows', async () => {
    const empty = createQuizFixture(adminId, 'Empty stats');
    const r = await request(base, 'GET', `/api/grading/${empty.sessionId}/summary`, adminToken);
    assert.deepEqual(r.body.languages, []);
  });
});

describe('migration', () => {
  const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8');

  test('text answers saved before S15 get their language from the script, once', () => {
    const mem = new Database(':memory:');
    mem.pragma('foreign_keys = ON');
    mem.exec(SCHEMA);
    runMigrations(mem);
    mem.prepare("INSERT INTO admins (username, password_hash) VALUES ('a', 'x')").run();
    const quizId = Number(
      mem.prepare("INSERT INTO quizzes (title, time_limit_seconds, created_by, base_language, content_languages) VALUES ('Q', 60, 1, 'de', '[\"de\"]')").run()
        .lastInsertRowid,
    );
    const textQ = Number(mem.prepare("INSERT INTO questions (quiz_id, sort_order, type, text, points) VALUES (?, 0, 'text', 'Wer?', 1)").run(quizId).lastInsertRowid);
    const choiceQ = Number(mem.prepare("INSERT INTO questions (quiz_id, sort_order, type, text, points) VALUES (?, 1, 'single', 'Was?', 1)").run(quizId).lastInsertRowid);
    const sessionId = Number(mem.prepare("INSERT INTO sessions (quiz_id, join_code) VALUES (?, 'OLD123')").run(quizId).lastInsertRowid);
    const answer = mem.prepare('INSERT INTO answers (session_id, question_id, participant_id, text_answer, selected_choice_ids) VALUES (?, ?, ?, ?, ?)');
    const texts = ['Josua', 'יהושע', 'Иисус', '40', '  '];
    const pids = texts.map((_, i) => Number(mem.prepare('INSERT INTO participants (session_id, display_name) VALUES (?, ?)').run(sessionId, `P${i}`).lastInsertRowid));
    texts.forEach((text, i) => answer.run(sessionId, textQ, pids[i], text, null));
    answer.run(sessionId, choiceQ, pids[0], null, '[1]');
    // As a database from before S15 has them (the column is added empty).
    mem.exec('UPDATE answers SET answer_lang = NULL');

    runMigrations(mem);
    const langs = mem.prepare('SELECT text_answer, answer_lang FROM answers ORDER BY id').all();
    assert.deepEqual(langs, [
      { text_answer: 'Josua', answer_lang: 'de' },
      { text_answer: 'יהושע', answer_lang: 'he' },
      { text_answer: 'Иисус', answer_lang: 'ru' },
      { text_answer: '40', answer_lang: null },
      { text_answer: '  ', answer_lang: null },
      { text_answer: null, answer_lang: null },
    ]);
    const before = mem.prepare('SELECT * FROM answers ORDER BY id').all();
    runMigrations(mem);
    assert.deepEqual(mem.prepare('SELECT * FROM answers ORDER BY id').all(), before, 'a second boot changes nothing');
  });
});
