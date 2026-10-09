import './env';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db';
import { CONTENT_LANGS } from '../lib/languages';
import { createAdmin, createQuizFixture, findKeys, join, login, request, startServer, type QuizFixture } from './helpers';

// Admin editor write path (wish 6, step S9): declared languages and question edits with stable choice ids.

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

/** Every `text_<lang>` key, empty unless given: the editor always sends all 14. */
function allTranslations(given: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(CONTENT_LANGS.map((l) => [`text_${l}`, given[l] ?? '']));
}

function declaredOf(quizId: number): string[] {
  return JSON.parse((db.prepare('SELECT content_languages FROM quizzes WHERE id = ?').get(quizId) as { content_languages: string }).content_languages);
}

describe('PUT /api/quizzes/:id/languages', () => {
  let fx: QuizFixture;
  let participantToken: string;

  before(async () => {
    fx = createQuizFixture(adminId, 'Languages quiz');
    db.prepare("UPDATE questions SET text_de = 'DE', text_fr = 'FR' WHERE quiz_id = ?").run(fx.quizId);
    db.prepare("UPDATE choices SET text_de = 'DE', text_fr = 'FR' WHERE question_id = ?").run(fx.singleQuestionId);
    db.prepare("UPDATE quizzes SET title_fr = 'Titre' WHERE id = ?").run(fx.quizId);
    const joined = await join(base, fx.joinCode, 'Language Kid');
    participantToken = joined.body.token;
  });

  test('admin only: no token 401, participant token 403, unknown quiz 404', async () => {
    const path = `/api/quizzes/${fx.quizId}/languages`;
    const body = { content_languages: ['en'] };
    const anon = await request(base, 'PUT', path, undefined, body);
    assert.equal(anon.status, 401);
    assert.equal(anon.body.code, 'AUTH_REQUIRED');
    const kid = await request(base, 'PUT', path, participantToken, body);
    assert.equal(kid.status, 403);
    assert.equal(kid.body.code, 'FORBIDDEN');
    assert.equal((await request(base, 'PUT', '/api/quizzes/99999/languages', adminToken, body)).status, 404);
  });

  test('invalid lists are a 400 and change nothing', async () => {
    const stored = db.prepare('SELECT content_languages FROM quizzes WHERE id = ?').get(fx.quizId);
    for (const content_languages of [['xx'], 'de', [1], null, ['en', 'klingon']]) {
      const r = await request(base, 'PUT', `/api/quizzes/${fx.quizId}/languages`, adminToken, { content_languages });
      assert.equal(r.status, 400, JSON.stringify(content_languages));
      assert.equal(r.body.error, 'content_languages must be an array of supported language codes');
    }
    assert.deepEqual(db.prepare('SELECT content_languages FROM quizzes WHERE id = ?').get(fx.quizId), stored);
  });

  test('× Français: arrays everywhere, no text touched, participants no longer offered French', async () => {
    const textsBefore = db.prepare('SELECT title_fr, description_fr FROM quizzes WHERE id = ?').get(fx.quizId);
    const questionsBefore = db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY id').all(fx.quizId);

    const r = await request(base, 'PUT', `/api/quizzes/${fx.quizId}/languages`, adminToken, { content_languages: ['de', 'en', 'de'] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.quiz.content_languages, ['en', 'de']);
    assert.deepEqual(r.body.quiz.offered_languages, ['en', 'de']);
    assert.equal(typeof r.body.quiz.missing_by_language, 'object');
    assert.equal(r.body.quiz.questions.length, 2);

    const one = await request(base, 'GET', `/api/quizzes/${fx.quizId}`, adminToken);
    assert.deepEqual(one.body.quiz.content_languages, ['en', 'de']);
    const list = await request(base, 'GET', '/api/quizzes', adminToken);
    const row = list.body.quizzes.find((q: { id: number }) => q.id === fx.quizId);
    assert.deepEqual(row.content_languages, ['en', 'de']);
    assert.ok(list.body.quizzes.every((q: { content_languages: unknown }) => Array.isArray(q.content_languages)));

    assert.deepEqual(db.prepare('SELECT title_fr, description_fr FROM quizzes WHERE id = ?').get(fx.quizId), textsBefore);
    assert.deepEqual(db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY id').all(fx.quizId), questionsBefore);

    assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, adminToken)).status, 200);
    const session = await request(base, 'GET', '/api/my/session', participantToken);
    assert.deepEqual(session.body.quiz.offered_languages, ['en', 'de']);
    const quiz = await request(base, 'GET', '/api/my/quiz', participantToken);
    assert.deepEqual(quiz.body.quiz.offered_languages, ['en', 'de']);
    for (const body of [session.body, quiz.body]) {
      assert.deepEqual(findKeys(body, ['content_languages', 'missing_by_language']), []);
    }

    // Adding French again brings its translations back at once.
    const re = await request(base, 'PUT', `/api/quizzes/${fx.quizId}/languages`, adminToken, { content_languages: ['en', 'de', 'fr'] });
    assert.deepEqual(re.body.quiz.offered_languages, ['en', 'de', 'fr']);
    const again = await request(base, 'GET', '/api/my/quiz', participantToken);
    assert.deepEqual(again.body.quiz.offered_languages, ['en', 'de', 'fr']);

    assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/end`, adminToken)).status, 200);
    const results = await request(base, 'GET', '/api/my/results', participantToken);
    assert.equal(results.status, 200);
    assert.deepEqual(findKeys(results.body, ['content_languages', 'missing_by_language']), []);
  });

  test('a German-base quiz cannot declare English', async () => {
    const quizId = Number(
      db.prepare("INSERT INTO quizzes (title, time_limit_seconds, created_by, base_language, content_languages) VALUES ('G', 60, ?, 'de', '[\"de\"]')").run(adminId)
        .lastInsertRowid,
    );
    const bad = await request(base, 'PUT', `/api/quizzes/${quizId}/languages`, adminToken, { content_languages: ['de', 'en'] });
    assert.equal(bad.status, 400);
    const ok = await request(base, 'PUT', `/api/quizzes/${quizId}/languages`, adminToken, { content_languages: ['pl'] });
    assert.deepEqual(ok.body.quiz.content_languages, ['de', 'pl']);
  });
});

describe('declared languages follow quiz and question writes', () => {
  test('POST /api/quizzes declares the base plus the filled-in title/description languages', async () => {
    const r = await request(base, 'POST', '/api/quizzes', adminToken, {
      title: 'New',
      description: '',
      time_limit_seconds: 60,
      title_he: 'חדש',
      description_ru: '  ',
    });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.quiz.content_languages, ['en', 'he']);
  });

  test('POST /api/quizzes/:id/questions adds the languages a new question is written in', async () => {
    const created = await request(base, 'POST', '/api/quizzes', adminToken, { title: 'Importer', description: '', time_limit_seconds: 60 });
    const quizId = created.body.quiz.id;
    assert.deepEqual(created.body.quiz.content_languages, ['en']);

    const r = await request(base, 'POST', `/api/quizzes/${quizId}/questions`, adminToken, {
      type: 'single',
      text: 'Q',
      ...allTranslations({ pl: 'Pytanie' }),
      points: 1,
      choices: [
        { id: 12345, text: 'a', ...allTranslations({ pl: 'a' }), is_correct: true },
        { text: 'b', ...allTranslations(), is_correct: false },
      ],
    });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.quiz.content_languages, ['en', 'pl']);
    assert.deepEqual(r.body.quiz.offered_languages, ['en'], 'Polish is declared but not complete yet');
    assert.notEqual(r.body.quiz.questions[0].choices[0].id, 12345, 'choice ids in a create body are ignored');

    const choiceB = r.body.quiz.questions[0].choices[1];
    const q = r.body.quiz.questions[0];
    const done = await request(base, 'PUT', `/api/questions/${q.id}`, adminToken, {
      type: 'single',
      text: 'Q',
      ...allTranslations({ pl: 'Pytanie' }),
      points: 1,
      choices: [
        { id: q.choices[0].id, text: 'a', ...allTranslations({ pl: 'a' }), is_correct: true },
        { id: choiceB.id, text: 'b', ...allTranslations({ pl: 'b' }), is_correct: false },
      ],
    });
    assert.equal(done.status, 200);
    assert.deepEqual(done.body.quiz.offered_languages, ['en', 'pl'], 'complete and declared: offered (cache invalidated)');
  });

  test('PUT /api/questions/:id never changes the declared list', async () => {
    const created = await request(base, 'POST', '/api/quizzes', adminToken, { title: 'Removed', description: '', time_limit_seconds: 60 });
    const quizId = created.body.quiz.id;
    const q = (
      await request(base, 'POST', `/api/quizzes/${quizId}/questions`, adminToken, { type: 'text', text: 'Q', ...allTranslations({ lt: 'K' }), points: 1 })
    ).body.quiz.questions[0];
    await request(base, 'PUT', `/api/quizzes/${quizId}/languages`, adminToken, { content_languages: ['en'] });
    const r = await request(base, 'PUT', `/api/questions/${q.id}`, adminToken, { type: 'text', text: 'Q2', ...allTranslations({ lt: 'K2' }), points: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(declaredOf(quizId), ['en'], 'a deliberate × stays respected');
  });

  test('changing the main language moves the base to the front of the declared list', async () => {
    const created = await request(base, 'POST', '/api/quizzes', adminToken, {
      title: 'Base change',
      description: '',
      time_limit_seconds: 60,
      title_de: 'Basiswechsel',
      title_ru: 'Смена',
    });
    const quizId = created.body.quiz.id;
    assert.deepEqual(created.body.quiz.content_languages, ['en', 'de', 'ru']);
    const meta = { title: 'Base change', description: '', time_limit_seconds: 60 };
    const toGerman = await request(base, 'PUT', `/api/quizzes/${quizId}`, adminToken, { ...meta, base_language: 'de' });
    assert.equal(toGerman.status, 200);
    assert.deepEqual(toGerman.body.quiz.content_languages, ['de', 'ru']);
    const same = await request(base, 'PUT', `/api/quizzes/${quizId}`, adminToken, { ...meta, base_language: 'de' });
    assert.deepEqual(same.body.quiz.content_languages, ['de', 'ru'], 'an unchanged base leaves the list alone');
    const back = await request(base, 'PUT', `/api/quizzes/${quizId}`, adminToken, { ...meta, base_language: 'en' });
    // These PUTs send no title_de, so the German title is gone and Deutsch is not kept.
    assert.deepEqual(back.body.quiz.content_languages, ['en', 'ru']);
  });

  test('main language en -> de -> en keeps a complete German translation declared and offered (5786 round trip)', async () => {
    const created = await request(base, 'POST', '/api/quizzes', adminToken, { title: 'Round trip', description: '', time_limit_seconds: 60 });
    const quizId = created.body.quiz.id;
    const q = await request(base, 'POST', `/api/quizzes/${quizId}/questions`, adminToken, {
      type: 'single',
      text: 'Q',
      ...allTranslations({ de: 'F', ru: 'В' }),
      points: 1,
      choices: [
        { text: 'a', ...allTranslations({ de: 'a', ru: 'а' }), is_correct: true },
        { text: 'b', ...allTranslations({ de: 'b', ru: 'б' }), is_correct: false },
      ],
    });
    assert.deepEqual(q.body.quiz.offered_languages, ['en', 'de', 'ru']);
    const meta = { title: 'Round trip', description: '', time_limit_seconds: 60 };
    const toGerman = await request(base, 'PUT', `/api/quizzes/${quizId}`, adminToken, { ...meta, base_language: 'de' });
    assert.deepEqual(toGerman.body.quiz.content_languages, ['de', 'ru']);
    const back = await request(base, 'PUT', `/api/quizzes/${quizId}`, adminToken, { ...meta, base_language: 'en' });
    assert.deepEqual(back.body.quiz.content_languages, ['en', 'de', 'ru']);
    assert.deepEqual(back.body.quiz.offered_languages, ['en', 'de', 'ru']);

    // A German-only quiz (German in the base fields, nothing in text_de) switched to English does not declare Deutsch.
    const german = await request(base, 'POST', '/api/quizzes', adminToken, { ...meta, title: 'Nur Deutsch', base_language: 'de' });
    await request(base, 'POST', `/api/quizzes/${german.body.quiz.id}/questions`, adminToken, { type: 'text', text: 'Frage', points: 1 });
    const english = await request(base, 'PUT', `/api/quizzes/${german.body.quiz.id}`, adminToken, { ...meta, title: 'Nur Deutsch', base_language: 'en' });
    assert.deepEqual(english.body.quiz.content_languages, ['en']);
  });
});

describe('editing a question during a live session', () => {
  let fx: QuizFixture;
  let kid: string;

  before(async () => {
    fx = createQuizFixture(adminId, 'Live edit quiz');
    assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, adminToken)).status, 200);
    kid = (await join(base, fx.joinCode, 'Live Kid')).body.token;
  });

  test('reordering, renaming and translating choices keeps a saved answer valid and correctly graded', async () => {
    const save = (ids: number[]) => request(base, 'POST', `/api/my/answers/${fx.singleQuestionId}`, kid, { selected_choice_ids: ids });
    assert.equal((await save([fx.correctChoiceId])).status, 200);

    // The editor sends the choice ids it loaded: choices swapped, renamed, translated, one added.
    const edit = await request(base, 'PUT', `/api/questions/${fx.singleQuestionId}`, adminToken, {
      type: 'single',
      text: '2 + 2 = ? (typo fixed)',
      ...allTranslations({ de: '2 + 2 = ?' }),
      points: 1,
      choices: [
        { id: fx.correctChoiceId, text: 'four', ...allTranslations({ de: 'vier' }), is_correct: true },
        { id: fx.wrongChoiceId, text: 'three', ...allTranslations({ de: 'drei' }), is_correct: false },
        { text: 'five', ...allTranslations({ de: 'fünf' }), is_correct: false },
      ],
    });
    assert.equal(edit.status, 200);

    const quiz = await request(base, 'GET', '/api/my/quiz', kid);
    const q = quiz.body.questions.find((x: { id: number }) => x.id === fx.singleQuestionId);
    assert.deepEqual(q.myAnswer.selected_choice_ids, [fx.correctChoiceId]);
    assert.deepEqual(
      q.choices.map((c: { id: number; text: string; text_de: string }) => [c.id, c.text, c.text_de]).slice(0, 2),
      [
        [fx.correctChoiceId, 'four', 'vier'],
        [fx.wrongChoiceId, 'three', 'drei'],
      ],
    );

    // The participant changes the answer with the ids loaded before the edit: no 400.
    assert.equal((await save([fx.wrongChoiceId])).status, 200);
    assert.equal((await save([fx.correctChoiceId])).status, 200);
    const stored = db
      .prepare('SELECT selected_choice_ids, is_correct, points_awarded FROM answers WHERE question_id = ?')
      .get(fx.singleQuestionId);
    assert.deepEqual(stored, { selected_choice_ids: JSON.stringify([fx.correctChoiceId]), is_correct: 1, points_awarded: 1 });
  });

  test('changing the correct answer while the session runs regrades the saved answer', async () => {
    const choices = db.prepare('SELECT id, text FROM choices WHERE question_id = ? ORDER BY sort_order').all(fx.singleQuestionId) as {
      id: number;
      text: string;
    }[];
    const r = await request(base, 'PUT', `/api/questions/${fx.singleQuestionId}`, adminToken, {
      type: 'single',
      text: '2 + 2 = ?',
      ...allTranslations(),
      points: 1.5,
      choices: choices.map((c) => ({ id: c.id, text: c.text, ...allTranslations(), is_correct: c.id === fx.wrongChoiceId })),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(
      db.prepare('SELECT is_correct, points_awarded FROM answers WHERE question_id = ?').get(fx.singleQuestionId),
      { is_correct: 0, points_awarded: 0 },
    );
  });

  test('a foreign choice id is a 400 and a text/choice switch with answers is a 409', async () => {
    const other = createQuizFixture(adminId, 'Other quiz');
    const foreign = await request(base, 'PUT', `/api/questions/${fx.singleQuestionId}`, adminToken, {
      type: 'single',
      text: 'x',
      points: 1,
      choices: [
        { id: other.correctChoiceId, text: 'a', is_correct: true },
        { text: 'b', is_correct: false },
      ],
    });
    assert.equal(foreign.status, 400);
    assert.deepEqual(foreign.body, { error: 'choice id does not belong to this question' });

    const toText = await request(base, 'PUT', `/api/questions/${fx.singleQuestionId}`, adminToken, { type: 'text', text: 'x', points: 1 });
    assert.equal(toText.status, 409);
    assert.deepEqual(toText.body, { error: 'has_answers' });
    assert.equal((db.prepare('SELECT type FROM questions WHERE id = ?').get(fx.singleQuestionId) as { type: string }).type, 'single');
  });

  test('an editor without choice ids cannot wipe the answer key of an answered question (ended session)', async () => {
    const ended = createQuizFixture(adminId, 'Ended edit quiz');
    assert.equal((await request(base, 'PUT', `/api/sessions/${ended.sessionId}/start`, adminToken)).status, 200);
    const tokens = [];
    for (const name of ['R1', 'R2', 'R3']) {
      const t = (await join(base, ended.joinCode, name)).body.token;
      assert.equal((await request(base, 'POST', `/api/my/answers/${ended.singleQuestionId}`, t, { selected_choice_ids: [ended.correctChoiceId] })).status, 200);
      tokens.push(t);
    }
    assert.equal((await request(base, 'PUT', `/api/sessions/${ended.sessionId}/end`, adminToken)).status, 200);
    const grades = () =>
      db.prepare('SELECT selected_choice_ids, is_correct, points_awarded, grade_version FROM answers WHERE question_id = ? ORDER BY id').all(ended.singleQuestionId);
    const before = { grades: grades(), choices: db.prepare('SELECT * FROM choices WHERE question_id = ?').all(ended.singleQuestionId) };

    const stale = await request(base, 'PUT', `/api/questions/${ended.singleQuestionId}`, adminToken, {
      type: 'single',
      text: '2 + 2 = ? (typo fixed)',
      points: 1,
      choices: [
        { text: '3', is_correct: false },
        { text: '4', is_correct: true },
      ],
    });
    assert.equal(stale.status, 409);
    // Old editors show `error` as is, so it is a sentence; current editors key on `code`.
    assert.deepEqual(stale.body, { error: 'This editor is out of date. Reload the page and edit again.', code: 'stale_editor' });
    assert.deepEqual({ grades: grades(), choices: db.prepare('SELECT * FROM choices WHERE question_id = ?').all(ended.singleQuestionId) }, before);
    assert.ok((grades() as { points_awarded: number }[]).every((g) => g.points_awarded === 1));
  });

  test('half points are accepted, other fractions are a 400', async () => {
    const ok = await request(base, 'PUT', `/api/questions/${fx.textQuestionId}`, adminToken, { type: 'text', text: 'Explain gravity.', points: 2.5 });
    assert.equal(ok.status, 200);
    const bad = await request(base, 'PUT', `/api/questions/${fx.textQuestionId}`, adminToken, { type: 'text', text: 'Explain gravity.', points: 2.3 });
    assert.equal(bad.status, 400);
  });
});
