import './env';
import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate';
import { parseQuestionInput, type QuestionInput } from '../lib/questionInput';
import { QuestionWriteError, STALE_EDITOR_MESSAGE, updateQuestionWithChoices } from '../lib/questionWrite';
import { isValidPoints, roundPoints } from '../lib/grading';

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8');

let db: Database.Database;
let quizId: number;
let sessionId: number;
let participantSeq = 0;

function freshDb(): Database.Database {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  d.exec(SCHEMA);
  runMigrations(d);
  d.prepare("INSERT INTO admins (username, password_hash) VALUES ('admin', 'x')").run();
  return d;
}

beforeEach(() => {
  db = freshDb();
  quizId = Number(db.prepare("INSERT INTO quizzes (title, time_limit_seconds, created_by) VALUES ('Q', 600, 1)").run().lastInsertRowid);
  sessionId = Number(db.prepare("INSERT INTO sessions (quiz_id, join_code, status) VALUES (?, 'ABC123', 'active')").run(quizId).lastInsertRowid);
});

/** A question with choices A, B, C (B correct); returns their ids in that order. */
function addChoiceQuestion(type: 'single' | 'multiple' = 'single', points = 1) {
  const questionId = Number(
    db.prepare('INSERT INTO questions (quiz_id, sort_order, type, text, points) VALUES (?, 0, ?, ?, ?)').run(quizId, type, 'Pick', points)
      .lastInsertRowid,
  );
  const ids = ['A', 'B', 'C'].map((t, i) =>
    Number(
      db.prepare('INSERT INTO choices (question_id, text, text_de, is_correct, sort_order) VALUES (?, ?, ?, ?, ?)').run(
        questionId,
        t,
        `${t}-de`,
        t === 'B' ? 1 : 0,
        i,
      ).lastInsertRowid,
    ),
  );
  return { questionId, ids };
}

function addAnswer(questionId: number, fields: Record<string, unknown>, inSession = sessionId): number {
  participantSeq += 1;
  const participantId = Number(
    db.prepare('INSERT INTO participants (session_id, display_name) VALUES (?, ?)').run(inSession, `P${participantSeq}`).lastInsertRowid,
  );
  const cols = ['session_id', 'question_id', 'participant_id', ...Object.keys(fields)];
  return Number(
    db
      .prepare(`INSERT INTO answers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(inSession, questionId, participantId, ...Object.values(fields)).lastInsertRowid,
  );
}

/** An ended earlier run of the same quiz (its answers are history that edits must not spoil). */
function endedSession(): number {
  return Number(
    db.prepare("INSERT INTO sessions (quiz_id, join_code, status) VALUES (?, ?, 'ended')").run(quizId, `END${participantSeq}${Date.now() % 1000}`)
      .lastInsertRowid,
  );
}

function parse(body: object): QuestionInput {
  const parsed = parseQuestionInput(body);
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed;
}

function choices(questionId: number) {
  return db.prepare('SELECT id, text, text_de, text_ru, is_correct, sort_order FROM choices WHERE question_id = ? ORDER BY sort_order').all(
    questionId,
  ) as { id: number; text: string; text_de: string | null; text_ru: string | null; is_correct: number; sort_order: number }[];
}

function answer(id: number) {
  return db.prepare('SELECT is_correct, points_awarded, grade_version, selected_choice_ids FROM answers WHERE id = ?').get(id) as {
    is_correct: number | null;
    points_awarded: number | null;
    grade_version: number;
    selected_choice_ids: string | null;
  };
}

function expectWriteError(fn: () => unknown, status: number, error: string, code?: string) {
  assert.throws(
    fn,
    (err: unknown) => err instanceof QuestionWriteError && err.status === status && err.body.error === error && err.body.code === code,
  );
}

describe('updateQuestionWithChoices: choices matched by id', () => {
  test('kept ids keep their identity and get new texts; missing ids are deleted; new choices are inserted', () => {
    const { questionId, ids } = addChoiceQuestion();
    const [a, b, c] = ids;
    updateQuestionWithChoices(
      db,
      questionId,
      parse({
        type: 'single',
        text: 'Pick one',
        points: 1,
        choices: [
          { id: b, text: 'B (renamed)', text_de: 'B neu', is_correct: true },
          { id: a, text: 'A', text_de: 'A neu', is_correct: false },
          { text: 'D', text_de: 'D-de', is_correct: false },
        ],
      }),
    );
    const rows = choices(questionId);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.sort_order), [0, 1, 2]);
    assert.deepEqual(rows.slice(0, 2).map((r) => [r.id, r.text, r.text_de]), [
      [b, 'B (renamed)', 'B neu'],
      [a, 'A', 'A neu'],
    ]);
    assert.ok(!ids.includes(rows[2].id), 'the new choice gets a new id');
    assert.equal(rows[2].text, 'D');
    assert.equal(db.prepare('SELECT id FROM choices WHERE id = ?').get(c), undefined, 'the choice that was not sent is deleted');
  });

  test('an id of another question is rejected with 400 and nothing changes', () => {
    const first = addChoiceQuestion();
    const second = addChoiceQuestion();
    const before = choices(first.questionId);
    expectWriteError(
      () =>
        updateQuestionWithChoices(
          db,
          first.questionId,
          parse({
            type: 'single',
            text: 'Changed text',
            points: 1,
            choices: [
              { id: first.ids[1], text: 'B', is_correct: true },
              { id: second.ids[0], text: 'stolen', is_correct: false },
            ],
          }),
        ),
      400,
      'choice id does not belong to this question',
    );
    assert.deepEqual(choices(first.questionId), before);
    assert.equal((db.prepare('SELECT text FROM questions WHERE id = ?').get(first.questionId) as { text: string }).text, 'Pick');
  });

  test('parseQuestionInput rejects a duplicate or malformed choice id', () => {
    const base = { type: 'single', text: 'T', points: 1 };
    assert.deepEqual(
      parseQuestionInput({ ...base, choices: [{ id: 5, text: 'a', is_correct: true }, { id: 5, text: 'b' }] }),
      { error: 'duplicate choice id' },
    );
    for (const id of [0, -1, 1.5, '3']) {
      assert.deepEqual(parseQuestionInput({ ...base, choices: [{ id, text: 'a', is_correct: true }, { text: 'b' }] }), {
        error: 'choice id must be a positive integer',
      });
    }
  });

  test('without ids (old clients) the choices are replaced, as before', () => {
    const { questionId, ids } = addChoiceQuestion();
    updateQuestionWithChoices(
      db,
      questionId,
      parse({ type: 'single', text: 'T', points: 1, choices: [{ text: 'X', is_correct: true }, { text: 'Y' }] }),
    );
    const rows = choices(questionId);
    assert.deepEqual(rows.map((r) => r.text), ['X', 'Y']);
    assert.ok(rows.every((r) => !ids.includes(r.id)));
  });

  test('a translation that was not sent is cleared, one that was sent is kept (clients send all 14 keys)', () => {
    const { questionId, ids } = addChoiceQuestion();
    db.prepare("UPDATE choices SET text_ru = 'Б' WHERE id = ?").run(ids[1]);
    updateQuestionWithChoices(
      db,
      questionId,
      parse({
        type: 'single',
        text: 'T',
        points: 1,
        choices: [
          { id: ids[0], text: 'A', text_de: 'A-de', is_correct: false },
          { id: ids[1], text: 'B', text_de: 'B-de', text_ru: 'Б', is_correct: true },
        ],
      }),
    );
    assert.deepEqual(choices(questionId).map((r) => r.text_ru), [null, 'Б']);
  });

  test('a missing question is a 404', () => {
    expectWriteError(
      () => updateQuestionWithChoices(db, 9999, parse({ type: 'text', text: 'T', points: 1 })),
      404,
      'Question not found',
    );
  });
});

describe('updateQuestionWithChoices: type changes', () => {
  test('choice → text with answers is a 409 has_answers; without answers it is allowed', () => {
    const withAnswers = addChoiceQuestion();
    addAnswer(withAnswers.questionId, { selected_choice_ids: JSON.stringify([withAnswers.ids[1]]), grade_source: 'auto_choice' });
    expectWriteError(
      () => updateQuestionWithChoices(db, withAnswers.questionId, parse({ type: 'text', text: 'Now open', points: 1 })),
      409,
      'has_answers',
    );
    assert.equal(choices(withAnswers.questionId).length, 3);
    assert.equal((db.prepare('SELECT type FROM questions WHERE id = ?').get(withAnswers.questionId) as { type: string }).type, 'single');

    const fresh = addChoiceQuestion();
    updateQuestionWithChoices(db, fresh.questionId, parse({ type: 'text', text: 'Now open', points: 1 }));
    assert.equal(choices(fresh.questionId).length, 0);
  });

  test('text → choice with answers is a 409; single ↔ multiple is allowed', () => {
    const textId = Number(
      db.prepare("INSERT INTO questions (quiz_id, sort_order, type, text, points) VALUES (?, 1, 'text', 'Open', 1)").run(quizId).lastInsertRowid,
    );
    addAnswer(textId, { text_answer: 'hello' });
    expectWriteError(
      () =>
        updateQuestionWithChoices(
          db,
          textId,
          parse({ type: 'single', text: 'Open', points: 1, choices: [{ text: 'a', is_correct: true }, { text: 'b' }] }),
        ),
      409,
      'has_answers',
    );

    const { questionId, ids } = addChoiceQuestion('single');
    addAnswer(questionId, { selected_choice_ids: JSON.stringify([ids[1]]), is_correct: 1, points_awarded: 1, grade_source: 'auto_choice' });
    updateQuestionWithChoices(
      db,
      questionId,
      parse({
        type: 'multiple',
        text: 'Pick',
        points: 1,
        choices: ids.map((id, i) => ({ id, text: 'ABC'[i], is_correct: i === 1 })),
      }),
    );
    assert.equal((db.prepare('SELECT type FROM questions WHERE id = ?').get(questionId) as { type: string }).type, 'multiple');
  });
});

describe('updateQuestionWithChoices: regrading', () => {
  test('changing the correct choice regrades automatic grades and leaves unrelated answers alone', () => {
    const { questionId, ids } = addChoiceQuestion('single', 2);
    const pickedB = addAnswer(questionId, { selected_choice_ids: JSON.stringify([ids[1]]), is_correct: 1, points_awarded: 2, grade_source: 'auto_choice' });
    const pickedC = addAnswer(questionId, { selected_choice_ids: JSON.stringify([ids[2]]), is_correct: 0, points_awarded: 0, grade_source: 'auto_choice' });
    const pickedA = addAnswer(questionId, { selected_choice_ids: JSON.stringify([ids[0]]), is_correct: 0, points_awarded: 0, grade_source: 'auto_choice' });

    const result = updateQuestionWithChoices(
      db,
      questionId,
      parse({ type: 'single', text: 'Pick', points: 2, choices: ids.map((id, i) => ({ id, text: 'ABC'[i], is_correct: i === 2 })) }),
    );
    assert.deepEqual(answer(pickedB), { ...answer(pickedB), is_correct: 0, points_awarded: 0, grade_version: 1 });
    assert.deepEqual(answer(pickedC), { ...answer(pickedC), is_correct: 1, points_awarded: 2, grade_version: 1 });
    assert.equal(answer(pickedA).grade_version, 0, 'an unchanged grade is not rewritten');
    assert.deepEqual([...result.regradedBySession.entries()], [[sessionId, [pickedB, pickedC]]]);
  });

  test('changing the points regrades automatic grades and moves human grades to the new maximum', () => {
    const { questionId, ids } = addChoiceQuestion('single', 2);
    const auto = addAnswer(questionId, { selected_choice_ids: JSON.stringify([ids[1]]), is_correct: 1, points_awarded: 2, grade_source: 'auto_choice' });
    const humanFull = addAnswer(questionId, { selected_choice_ids: JSON.stringify([ids[0]]), is_correct: 1, points_awarded: 2, grade_source: 'human' });
    const humanPartial = addAnswer(questionId, { selected_choice_ids: JSON.stringify([ids[0]]), is_correct: 0, points_awarded: 0.5, grade_source: 'human' });
    const humanClamped = addAnswer(questionId, { selected_choice_ids: JSON.stringify([ids[0]]), is_correct: 0, points_awarded: 1.5, grade_source: 'human' });

    updateQuestionWithChoices(
      db,
      questionId,
      parse({ type: 'single', text: 'Pick', points: 1, choices: ids.map((id, i) => ({ id, text: 'ABC'[i], is_correct: i === 1 })) }),
    );
    assert.equal(answer(auto).points_awarded, 1);
    assert.equal(answer(humanFull).points_awarded, 1);
    assert.deepEqual(answer(humanClamped), { ...answer(humanClamped), points_awarded: 1, is_correct: 0 }, 'clamped to the new maximum; the grader\'s verdict stays');
    assert.deepEqual(answer(humanPartial), { ...answer(humanPartial), points_awarded: 0.5, is_correct: 0, grade_version: 0 }, 'below the new maximum: untouched');

    updateQuestionWithChoices(
      db,
      questionId,
      parse({ type: 'single', text: 'Pick', points: 3, choices: ids.map((id, i) => ({ id, text: 'ABC'[i], is_correct: i === 1 })) }),
    );
    assert.equal(answer(auto).points_awarded, 3);
    assert.equal(answer(humanFull).points_awarded, 3, 'a full-points grade follows the maximum up');
    assert.equal(answer(humanPartial).points_awarded, 0.5, 'a partial grade is not raised');
  });

  test('an answer whose selected choice was deleted keeps its grade when the answer key changes (ended run too)', () => {
    const { questionId, ids } = addChoiceQuestion('single', 1);
    const [a, b, c] = ids;
    const ended = endedSession();
    const pickedOldCorrect = addAnswer(questionId, { selected_choice_ids: JSON.stringify([b]), is_correct: 1, points_awarded: 1, grade_source: 'auto_choice' }, ended);
    const pickedC = addAnswer(questionId, { selected_choice_ids: JSON.stringify([c]), is_correct: 0, points_awarded: 0, grade_source: 'auto_choice' }, ended);
    const pickedA = addAnswer(questionId, { selected_choice_ids: JSON.stringify([a]), is_correct: 0, points_awarded: 0, grade_source: 'auto_choice' });

    // B is deleted and C becomes correct: B's answer cannot be graded against the new key.
    const result = updateQuestionWithChoices(
      db,
      questionId,
      parse({ type: 'single', text: 'Pick', points: 1, choices: [{ id: a, text: 'A', is_correct: false }, { id: c, text: 'C', is_correct: true }] }),
    );
    assert.deepEqual(answer(pickedOldCorrect), { selected_choice_ids: JSON.stringify([b]), is_correct: 1, points_awarded: 1, grade_version: 0 });
    assert.deepEqual(answer(pickedC), { ...answer(pickedC), is_correct: 1, points_awarded: 1, grade_version: 1 });
    assert.equal(answer(pickedA).grade_version, 0);
    assert.deepEqual([...result.regradedBySession.entries()], [[ended, [pickedC]]]);
  });

  test('choices without any id on a question with answers are a 409 stale_editor and nothing changes (ended run)', () => {
    const { questionId, ids } = addChoiceQuestion('single', 1);
    const ended = endedSession();
    const picked = [1, 2, 3].map(() =>
      addAnswer(questionId, { selected_choice_ids: JSON.stringify([ids[1]]), is_correct: 1, points_awarded: 1, grade_source: 'auto_choice' }, ended),
    );
    const before = { question: db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId), choices: choices(questionId), answers: picked.map(answer) };
    // What an editor from before stable choice ids sends: a typo fix, the same choices, no ids.
    expectWriteError(
      () =>
        updateQuestionWithChoices(
          db,
          questionId,
          parse({ type: 'single', text: 'Pick (typo fixed)', points: 1, choices: [{ text: 'A' }, { text: 'B', is_correct: true }, { text: 'C' }] }),
        ),
      409,
      STALE_EDITOR_MESSAGE,
      'stale_editor',
    );
    assert.deepEqual(
      { question: db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId), choices: choices(questionId), answers: picked.map(answer) },
      before,
    );
  });

  test('the question, its choices and the regrade commit together or not at all', () => {
    const { questionId, ids } = addChoiceQuestion('single', 1);
    const picked = addAnswer(questionId, { selected_choice_ids: JSON.stringify([ids[1]]), is_correct: 1, points_awarded: 1, grade_source: 'auto_choice' });
    db.exec("CREATE TEMP TRIGGER fail_regrade BEFORE UPDATE OF points_awarded ON answers BEGIN SELECT RAISE(ABORT, 'regrade failed'); END");
    const choicesBefore = choices(questionId);
    assert.throws(() =>
      updateQuestionWithChoices(
        db,
        questionId,
        parse({ type: 'single', text: 'Edited', points: 2, choices: ids.map((id, i) => ({ id, text: `${'ABC'[i]}!`, is_correct: i === 1 })) }),
      ),
    /regrade failed/);
    assert.deepEqual(db.prepare('SELECT text, points FROM questions WHERE id = ?').get(questionId), { text: 'Pick', points: 1 });
    assert.deepEqual(choices(questionId), choicesBefore);
    assert.deepEqual(answer(picked), { ...answer(picked), points_awarded: 1, grade_version: 0 });

    db.exec('DROP TRIGGER fail_regrade');
    updateQuestionWithChoices(
      db,
      questionId,
      parse({ type: 'single', text: 'Edited', points: 2, choices: ids.map((id, i) => ({ id, text: `${'ABC'[i]}!`, is_correct: i === 1 })) }),
    );
    assert.deepEqual(db.prepare('SELECT text, points FROM questions WHERE id = ?').get(questionId), { text: 'Edited', points: 2 });
    assert.equal(answer(picked).points_awarded, 2);
  });

  test('a text edit with unchanged points and answer key regrades nothing', () => {
    const { questionId, ids } = addChoiceQuestion('single', 1);
    const picked = addAnswer(questionId, { selected_choice_ids: JSON.stringify([ids[1]]), is_correct: 1, points_awarded: 1, grade_source: 'auto_choice' });
    const result = updateQuestionWithChoices(
      db,
      questionId,
      parse({ type: 'single', text: 'Typo fixed', points: 1, choices: ids.map((id, i) => ({ id, text: 'ABC'[i], text_de: 'x', is_correct: i === 1 })) }),
    );
    assert.equal(result.regradedBySession.size, 0);
    assert.equal(answer(picked).grade_version, 0);
  });
});

describe('isValidPoints (decision Q-points-step)', () => {
  test('integers and halves pass; other values fail', () => {
    for (const ok of [0.5, 1, 1.5, 2, 10, 100]) assert.equal(isValidPoints(ok), true, String(ok));
    for (const bad of [0, -1, -0.5, 0.3, 1.25, 100.5, Number.NaN, Infinity, '1', null, undefined]) {
      assert.equal(isValidPoints(bad), false, String(bad));
    }
  });

  test('allowZero accepts 0 for awarded points, still not negatives', () => {
    assert.equal(isValidPoints(0, { allowZero: true }), true);
    assert.equal(isValidPoints(-0.5, { allowZero: true }), false);
  });

  test('a positive value that would be stored as 0 is not valid question points', () => {
    for (const tiny of [1e-10, 1e-12, Number.MIN_VALUE]) {
      assert.equal(isValidPoints(tiny), false, String(tiny));
      assert.equal(roundPoints(tiny), 0);
    }
    assert.match((parseQuestionInput({ type: 'text', text: 'T', points: 1e-10 }) as { error: string }).error, /half/);
  });

  test('stored points have no float noise, and parseQuestionInput enforces the step', () => {
    assert.equal(roundPoints(0.1 + 0.2 + 1.2), 1.5);
    assert.equal(parse({ type: 'text', text: 'T', points: 1.5 }).points, 1.5);
    assert.equal(parse({ type: 'text', text: 'T', points: '2' }).points, 2);
    assert.match((parseQuestionInput({ type: 'text', text: 'T', points: 1.3 }) as { error: string }).error, /half/);
    assert.match((parseQuestionInput({ type: 'text', text: 'T', points: 0 }) as { error: string }).error, /half/);
  });
});
