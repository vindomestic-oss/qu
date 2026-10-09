import './env';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { io as connect, type Socket } from 'socket.io-client';
import { db } from '../db';
import { backfillAnswerKeys, backfillAnswerKeyShortForms, backfillAnswerNorms, runMigrations } from '../db/migrate';
import { CHIDON_5786_KEY, CHIDON_5787_ANFAENGER_KEY, CHIDON_5787_FORTGESCHRITTENE_KEY, CHIDON_ANSWER_KEYS } from '../db/chidonAnswerKey';
import { cleanAccepted } from '../lib/aiGrading/accepted';
import { normalizeForMatch } from '../lib/aiGrading/normalize';
import { enqueueSession, processAnswer, requeueQuestion } from '../lib/aiGrading/process';
import { createAdmin, findKeys, join, login, request, startServer } from './helpers';
import { createUniqueJoinCode } from '../lib/sessions';

// Wish 7, layer A (S13): the reference check, its triggers, re-checks, the accepted-answers
// endpoint, the panel payload (grouping data, precedents) and the migrations.

let base = '';
let close: () => Promise<void>;
let adminId: number;
let adminToken: string;
const sockets: Socket[] = [];

before(async () => {
  ({ base, close } = await startServer());
  adminId = createAdmin();
  adminToken = await login(base);
});

after(async () => {
  for (const s of sockets) s.disconnect();
  await close();
});

interface Fixture {
  quizId: number;
  /** Text questions in order. */
  q: number[];
}

/** A quiz of text questions with optional model answers and accepted answers. */
function textQuiz(title: string, questions: { text: string; reference?: string; accepted?: string[]; points?: number }[]): Fixture {
  const quizId = Number(
    db.prepare('INSERT INTO quizzes (title, time_limit_seconds, created_by) VALUES (?, ?, ?)').run(title, 600, adminId).lastInsertRowid,
  );
  const insert = db.prepare(
    "INSERT INTO questions (quiz_id, sort_order, type, text, points, reference_answer, accepted_answers) VALUES (?, ?, 'text', ?, ?, ?, ?)",
  );
  const q = questions.map((x, i) =>
    Number(insert.run(quizId, i, x.text, x.points ?? 1, x.reference ?? null, x.accepted ? JSON.stringify(x.accepted) : null).lastInsertRowid),
  );
  return { quizId, q };
}

/** A started session of the quiz. */
async function run(quizId: number): Promise<{ sessionId: number; joinCode: string }> {
  const joinCode = createUniqueJoinCode();
  const sessionId = Number(db.prepare('INSERT INTO sessions (quiz_id, join_code) VALUES (?, ?)').run(quizId, joinCode).lastInsertRowid);
  assert.equal((await request(base, 'PUT', `/api/sessions/${sessionId}/start`, adminToken)).status, 200);
  return { sessionId, joinCode };
}

/** Joins and answers (question id → text), optionally submits. */
async function kid(joinCode: string, name: string, answers: Record<number, string>, submit = true) {
  const joined = await join(base, joinCode, name);
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  const token = joined.body.token as string;
  for (const [qid, text] of Object.entries(answers)) {
    assert.equal((await request(base, 'POST', `/api/my/answers/${qid}`, token, { text_answer: text })).status, 200);
  }
  if (submit) assert.equal((await request(base, 'POST', '/api/my/submit', token)).status, 200);
  return { token, id: joined.body.participant.id as number };
}

interface Row {
  id: number;
  points_awarded: number | null;
  is_correct: number | null;
  grade_source: string | null;
  graded_by: string | null;
  graded_at: string | null;
  grade_version: number;
  answer_norm: string | null;
  text_answer: string | null;
}

function row(participantId: number, questionId: number): Row {
  return db
    .prepare(
      `SELECT id, points_awarded, is_correct, grade_source, graded_by, graded_at, grade_version, answer_norm, text_answer
       FROM answers WHERE participant_id = ? AND question_id = ?`,
    )
    .get(participantId, questionId) as Row;
}

function events(answerId: number) {
  return db.prepare('SELECT action, actor, old_points, new_points, is_correct, grade_source FROM grade_events WHERE answer_id = ? ORDER BY id').all(answerId) as {
    action: string;
    actor: string | null;
    old_points: number | null;
    new_points: number | null;
    is_correct: number | null;
    grade_source: string | null;
  }[];
}

async function grade(sessionId: number, answerId: number, isCorrect: boolean, points: number, version: number, token = adminToken) {
  return request(base, 'PUT', `/api/grading/${sessionId}/answers/${answerId}`, token, {
    is_correct: isCorrect,
    points_awarded: points,
    expected_version: version,
  });
}

async function putText(questionId: number, body: object) {
  const current = db.prepare('SELECT text, points FROM questions WHERE id = ?').get(questionId) as { text: string; points: number };
  return request(base, 'PUT', `/api/questions/${questionId}`, adminToken, { type: 'text', text: current.text, points: current.points, ...body });
}

async function openSocket(): Promise<Socket> {
  const s = connect(base, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', reject);
  });
  return s;
}

describe('the reference check', () => {
  let fx: Fixture;
  let s: { sessionId: number; joinCode: string };

  before(async () => {
    fx = textQuiz('Rule quiz', [
      { text: 'Who was the first child Avraham circumcised?', reference: 'Yishmael', accepted: ['Ishmael'] },
      { text: 'Who deceived Yehoshua?', reference: "The Giv'onites", points: 2 },
      { text: 'No key here', points: 1 },
    ]);
    s = await run(fx.quizId);
  });

  test('on submit, exact and accepted matches get full points by the rule, with an audit row; the rest waits', async () => {
    const a = await kid(s.joinCode, 'Kid A', { [fx.q[0]]: 'yishmael.', [fx.q[1]]: 'GIVONITES', [fx.q[2]]: 'Yishmael' }, false);
    const before = row(a.id, fx.q[0]);
    assert.equal(before.points_awarded, null, 'nothing is graded before the participant submits');
    assert.equal(before.answer_norm, 'yishmael');
    assert.equal(before.text_answer, 'yishmael.', 'the answer text itself is never changed');

    assert.equal((await request(base, 'POST', '/api/my/submit', a.token)).status, 200);
    const q1 = row(a.id, fx.q[0]);
    assert.equal(q1.points_awarded, 1);
    assert.equal(q1.is_correct, 1);
    assert.equal(q1.grade_source, 'rule');
    assert.equal(q1.graded_by, 'auto');
    assert.ok(q1.graded_at && !Number.isNaN(Date.parse(q1.graded_at)));
    assert.equal(q1.grade_version, before.grade_version + 1);
    assert.deepEqual(events(q1.id), [{ action: 'rule_match', actor: 'auto', old_points: null, new_points: 1, is_correct: 1, grade_source: 'rule' }]);
    assert.equal(row(a.id, fx.q[1]).points_awarded, 2, 'full points of the question (2)');
    assert.equal(row(a.id, fx.q[2]).points_awarded, null, 'a question without a key is never auto-graded');

    const b = await kid(s.joinCode, 'Kid B', { [fx.q[0]]: 'Ismael', [fx.q[1]]: '  ' });
    assert.equal(row(b.id, fx.q[0]).points_awarded, null, 'a spelling that is not listed waits for a person');
    assert.equal(row(b.id, fx.q[1]).grade_source, 'auto_blank');
    assert.deepEqual(events(row(b.id, fx.q[1]).id), [], 'a blank answer is not touched');
    const accepted = await kid(s.joinCode, 'Kid C', { [fx.q[0]]: 'Ishmael' });
    assert.equal(row(accepted.id, fx.q[0]).grade_source, 'rule', 'an accepted answer counts like the model answer');
  });

  test('processAnswer leaves blank, graded and unsubmitted answers alone', async () => {
    const waiting = await kid(s.joinCode, 'Kid Waiting', { [fx.q[0]]: 'YISHMAEL' }, false);
    const r = row(waiting.id, fx.q[0]);
    assert.equal(processAnswer(db, r.id), false, 'not submitted yet');
    assert.equal(row(waiting.id, fx.q[0]).points_awarded, null);
    const graded = row((await kid(s.joinCode, 'Kid Human', { [fx.q[0]]: 'Ismael' })).id, fx.q[0]);
    assert.equal((await grade(s.sessionId, graded.id, true, 1, graded.grade_version)).status, 200);
    db.prepare("UPDATE answers SET text_answer = 'Yishmael', answer_norm = 'yishmael' WHERE id = ?").run(graded.id);
    assert.equal(processAnswer(db, graded.id), false, 'a human grade is never overwritten');
    assert.equal((db.prepare('SELECT grade_source FROM answers WHERE id = ?').get(graded.id) as { grade_source: string }).grade_source, 'human');
  });

  test('the end of the session checks everyone who had not submitted', async () => {
    const late = await kid(s.joinCode, 'Kid Late', { [fx.q[0]]: 'Yish-mael' }, false);
    // 'Yish-mael' → 'yish mael' → match key 'yishmael'.
    assert.equal(row(late.id, fx.q[0]).points_awarded, null);
    assert.equal((await request(base, 'PUT', `/api/sessions/${s.sessionId}/end`, adminToken)).status, 200);
    const r = row(late.id, fx.q[0]);
    assert.equal(r.grade_source, 'rule');
    assert.equal(r.points_awarded, 1);
    assert.equal(enqueueSession(db, s.sessionId).length, 0, 'a second run changes nothing');
  });
});

describe('a human grade always wins, and key changes re-check only rule grades', () => {
  let fx: Fixture;
  let s: { sessionId: number; joinCode: string };
  const kids: Record<string, { token: string; id: number }> = {};

  before(async () => {
    fx = textQuiz('Requeue quiz', [{ text: 'Where did Shaul go to the medium?', reference: 'Ein Dor', accepted: ['Endor'], points: 1 }]);
    s = await run(fx.quizId);
    kids.exact = await kid(s.joinCode, 'Exact', { [fx.q[0]]: 'Ein-Dor' });
    kids.variant = await kid(s.joinCode, 'Variant', { [fx.q[0]]: 'endor' });
    kids.overridden = await kid(s.joinCode, 'Overridden', { [fx.q[0]]: 'Eindor' });
    kids.other = await kid(s.joinCode, 'Other', { [fx.q[0]]: 'Eyn Dor' });
    kids.humanWrong = await kid(s.joinCode, 'Human wrong', { [fx.q[0]]: 'Ein Dor!' });
  });

  test('a grader overrides a rule grade with the usual versioned write', async () => {
    const r = row(kids.overridden.id, fx.q[0]);
    assert.equal(r.grade_source, 'rule');
    assert.equal((await grade(s.sessionId, r.id, false, 0, r.grade_version - 1)).status, 409, 'a grader who saw the version before the rule grade gets a conflict');
    const ok = await grade(s.sessionId, r.id, false, 0, r.grade_version);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.answer.grade_source, 'human');
    const h = row(kids.humanWrong.id, fx.q[0]);
    assert.equal((await grade(s.sessionId, h.id, false, 0.5, h.grade_version)).status, 200);
  });

  test('changing the accepted answers reverts rule grades that no longer match, credits new matches, never touches people', async () => {
    const staff = await openSocket();
    assert.equal((await staff.timeout(2000).emitWithAck('staff:join', { sessionId: s.sessionId, token: adminToken })).ok, true);
    const participant = await openSocket();
    assert.equal((await participant.timeout(2000).emitWithAck('session:join', { sessionId: s.sessionId, token: kids.other.token })).ok, true);
    const leaked: unknown[] = [];
    participant.on('grading:changed', (p) => leaked.push(p));
    const received = new Promise<{ kind: string; answerIds: number[] }>((resolve) =>
      staff.on('grading:changed', (p: { kind: string; answerIds: number[] }) => {
        if (p.kind === 'rule') resolve(p);
      }),
    );

    const variantBefore = row(kids.variant.id, fx.q[0]);
    const otherBefore = row(kids.other.id, fx.q[0]);
    assert.equal(variantBefore.grade_source, 'rule');
    assert.equal(otherBefore.points_awarded, null);
    // 'Endor' is replaced by 'Eyn Dor': Variant's rule grade goes back to review, Other is credited.
    const r = await putText(fx.q[0], { reference_answer: 'Ein Dor', accepted_answers: ['Eyn Dor'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));

    const variant = row(kids.variant.id, fx.q[0]);
    assert.deepEqual([variant.points_awarded, variant.grade_source, variant.graded_by], [null, null, null]);
    assert.equal(variant.grade_version, variantBefore.grade_version + 1);
    assert.deepEqual(events(variant.id).map((e) => e.action), ['rule_match', 'rule_revert']);
    const other = row(kids.other.id, fx.q[0]);
    assert.deepEqual([other.points_awarded, other.grade_source], [1, 'rule']);
    const exact = row(kids.exact.id, fx.q[0]);
    assert.equal(exact.grade_source, 'rule');
    assert.deepEqual(events(exact.id).map((e) => e.action), ['rule_match'], 'a rule grade that still matches is left alone');
    assert.deepEqual([row(kids.overridden.id, fx.q[0]).grade_source, row(kids.overridden.id, fx.q[0]).points_awarded], ['human', 0]);
    assert.deepEqual([row(kids.humanWrong.id, fx.q[0]).grade_source, row(kids.humanWrong.id, fx.q[0]).points_awarded], ['human', 0.5]);

    const event = await received;
    assert.deepEqual([...event.answerIds].sort((x, y) => x - y), [variant.id, other.id].sort((x, y) => x - y));
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(leaked, [], 'participants never receive grading events');
  });

  test('removing the model answer and every variant sends all rule grades back to review', async () => {
    assert.equal((await putText(fx.q[0], { reference_answer: '', accepted_answers: [] })).status, 200);
    for (const k of ['exact', 'variant', 'other']) assert.equal(row(kids[k].id, fx.q[0]).points_awarded, null, k);
    assert.equal(row(kids.overridden.id, fx.q[0]).grade_source, 'human');
    // And back: the rule credits them again; a PUT without grading keys changes nothing.
    assert.equal((await putText(fx.q[0], { reference_answer: 'Ein Dor', accepted_answers: ['Endor', 'Eyn Dor'] })).status, 200);
    for (const k of ['exact', 'variant', 'other']) assert.equal(row(kids[k].id, fx.q[0]).grade_source, 'rule', k);
    const version = row(kids.exact.id, fx.q[0]).grade_version;
    assert.equal((await putText(fx.q[0], {})).status, 200);
    assert.equal(row(kids.exact.id, fx.q[0]).grade_version, version);
    assert.equal(requeueQuestion(db, fx.q[0]).size, 0, 'a re-check without changes writes nothing');
  });

  test('new points: rule grades follow the maximum like automatic grades', async () => {
    assert.equal((await putText(fx.q[0], { points: 2 })).status, 200);
    assert.equal(row(kids.exact.id, fx.q[0]).points_awarded, 2);
    assert.equal(row(kids.humanWrong.id, fx.q[0]).points_awarded, 0.5);
    assert.equal((await putText(fx.q[0], { points: 1 })).status, 200);
  });
});

describe('accepted answers in the editor', () => {
  test('cleaned on save; an absent key keeps them; limits; choice questions clear them', async () => {
    const fx = textQuiz('Editor accepted quiz', [{ text: 'Who?', reference: 'Yishmael' }]);
    const read = () => db.prepare('SELECT accepted_answers FROM questions WHERE id = ?').pluck().get(fx.q[0]);
    assert.equal((await putText(fx.q[0], { accepted_answers: [' Ishmael ', 'ishmael!', '', 'Ismael', 'ישמעאל'] })).status, 200);
    assert.equal(read(), JSON.stringify(['Ishmael', 'Ismael', 'ישמעאל']));
    assert.equal((await putText(fx.q[0], { reference_answer: 'Yishmael' })).status, 200);
    assert.equal(read(), JSON.stringify(['Ishmael', 'Ismael', 'ישמעאל']), 'an absent key keeps the stored list');
    assert.equal((await putText(fx.q[0], { accepted_answers: 'Ishmael' })).status, 400);
    assert.equal((await putText(fx.q[0], { accepted_answers: ['x'.repeat(121)] })).status, 400);
    assert.equal((await putText(fx.q[0], { accepted_answers: Array.from({ length: 31 }, (_, i) => `v${i}`) })).status, 400);
    assert.equal(read(), JSON.stringify(['Ishmael', 'Ismael', 'ישמעאל']));

    const created = await request(base, 'POST', `/api/quizzes/${fx.quizId}/questions`, adminToken, {
      type: 'text',
      text: 'New one',
      points: 1,
      reference_answer: 'Kain',
      accepted_answers: ['Kajin', 'kajin'],
    });
    assert.equal(created.status, 201);
    const q = created.body.quiz.questions.find((x: { text: string }) => x.text === 'New one');
    assert.equal(q.accepted_answers, JSON.stringify(['Kajin']));
  });
});

describe('POST /api/questions/:id/accepted-answers', () => {
  let fx: Fixture;
  let s1: { sessionId: number; joinCode: string };
  let s2: { sessionId: number; joinCode: string };
  const k: Record<string, { token: string; id: number }> = {};

  before(async () => {
    fx = textQuiz('Accept variant quiz', [
      { text: 'Who was the first child Avraham circumcised?', reference: 'Yishmael' },
      { text: 'Another question', reference: 'Kain' },
    ]);
    s1 = await run(fx.quizId);
    s2 = await run(fx.quizId);
    k.graded = await kid(s1.joinCode, 'Graded', { [fx.q[0]]: ' Jischmael ', [fx.q[1]]: '   ' });
    k.sameOther = await kid(s2.joinCode, 'Same other run', { [fx.q[0]]: 'jischmael' });
    k.sameHuman = await kid(s2.joinCode, 'Same human', { [fx.q[0]]: 'JISCHMAEL' });
    k.notSubmitted = await kid(s2.joinCode, 'Not submitted', { [fx.q[0]]: 'Jischmael' }, false);
    const g = row(k.graded.id, fx.q[0]);
    assert.equal((await grade(s1.sessionId, g.id, true, 1, g.grade_version)).status, 200);
    const h = row(k.sameHuman.id, fx.q[0]);
    assert.equal((await grade(s2.sessionId, h.id, false, 0, h.grade_version)).status, 200);
  });

  test('participants, graders and anonymous callers are refused', async () => {
    const body = { answerId: row(k.graded.id, fx.q[0]).id };
    assert.equal((await request(base, 'POST', `/api/questions/${fx.q[0]}/accepted-answers`, undefined, body)).status, 401);
    assert.equal((await request(base, 'POST', `/api/questions/${fx.q[0]}/accepted-answers`, k.graded.token, body)).status, 403);
    const link = await request(base, 'POST', `/api/sessions/${s1.sessionId}/grader-links`, adminToken, { label: 'Rav K.' });
    const grader = await request(base, 'POST', '/api/grader/exchange', undefined, { code: link.body.code, name: 'Rav K.' });
    assert.equal(grader.status, 200);
    assert.equal((await request(base, 'POST', `/api/questions/${fx.q[0]}/accepted-answers`, grader.body.token, body)).status, 403);
    assert.equal(db.prepare('SELECT accepted_answers FROM questions WHERE id = ?').pluck().get(fx.q[0]), null);
  });

  test('bad requests: another question, a blank answer, no such answer', async () => {
    const post = (qid: number, answerId: unknown) => request(base, 'POST', `/api/questions/${qid}/accepted-answers`, adminToken, { answerId });
    assert.equal((await post(fx.q[1], row(k.graded.id, fx.q[0]).id)).status, 400);
    assert.equal((await post(fx.q[1], row(k.graded.id, fx.q[1]).id)).status, 400, 'blank');
    assert.equal((await post(fx.q[0], 987654)).status, 404);
    assert.equal((await post(fx.q[0], 'x')).status, 400);
  });

  test('adds the trimmed answer once, audits it, and credits the same answer of other runs (people stay)', async () => {
    const answerId = row(k.graded.id, fx.q[0]).id;
    const r = await request(base, 'POST', `/api/questions/${fx.q[0]}/accepted-answers`, adminToken, { answerId });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { accepted_answers: ['Jischmael'], added: true, regraded: 1 });
    assert.deepEqual(events(answerId).at(-1), {
      action: 'accept_variant',
      actor: 'admin:admin',
      old_points: 1,
      new_points: 1,
      is_correct: 1,
      grade_source: 'human',
    });
    assert.deepEqual([row(k.sameOther.id, fx.q[0]).grade_source, row(k.sameOther.id, fx.q[0]).points_awarded], ['rule', 1]);
    assert.deepEqual([row(k.sameHuman.id, fx.q[0]).grade_source, row(k.sameHuman.id, fx.q[0]).points_awarded], ['human', 0]);
    assert.equal(row(k.notSubmitted.id, fx.q[0]).points_awarded, null, 'still answering: checked at submit');
    assert.equal(row(k.graded.id, fx.q[0]).grade_source, 'human');

    const again = await request(base, 'POST', `/api/questions/${fx.q[0]}/accepted-answers`, adminToken, { answerId: row(k.sameOther.id, fx.q[0]).id });
    assert.deepEqual(again.body, { accepted_answers: ['Jischmael'], added: false, regraded: 0 });
    assert.equal(events(row(k.sameOther.id, fx.q[0]).id).filter((e) => e.action === 'accept_variant').length, 0);

    assert.equal((await request(base, 'POST', '/api/my/submit', k.notSubmitted.token)).status, 200);
    assert.equal(row(k.notSubmitted.id, fx.q[0]).grade_source, 'rule');
  });
});

describe('the panel: grouping data and precedent hints', () => {
  let fx: Fixture;
  let earlier: { sessionId: number; joinCode: string };
  let now: { sessionId: number; joinCode: string };
  const k: Record<string, { token: string; id: number }> = {};

  before(async () => {
    fx = textQuiz('Precedent quiz', [{ text: 'Who was the first child Avraham circumcised?', reference: 'Yishmael', accepted: ['Ishmael'] }]);
    earlier = await run(fx.quizId);
    const e1 = await kid(earlier.joinCode, 'E1', { [fx.q[0]]: 'Ismael' });
    const e2 = await kid(earlier.joinCode, 'E2', { [fx.q[0]]: 'ismael.' });
    const e3 = await kid(earlier.joinCode, 'E3', { [fx.q[0]]: 'Izmail' });
    await kid(earlier.joinCode, 'E4', { [fx.q[0]]: 'Yishmael' }); // a rule grade: not a precedent
    for (const [p, points] of [
      [e1, 1],
      [e2, 0.5],
      [e3, 1],
    ] as const) {
      const r = row(p.id, fx.q[0]);
      assert.equal((await grade(earlier.sessionId, r.id, true, points, r.grade_version)).status, 200);
    }
    now = await run(fx.quizId);
    k.a = await kid(now.joinCode, 'Now A', { [fx.q[0]]: 'Ismael' });
    k.b = await kid(now.joinCode, 'Now B', { [fx.q[0]]: 'ISMAEL' });
    k.c = await kid(now.joinCode, 'Now C', { [fx.q[0]]: 'izmail' });
    k.d = await kid(now.joinCode, 'Now D', { [fx.q[0]]: 'yishmael' });
    k.e = await kid(now.joinCode, 'Now E', { [fx.q[0]]: 'Avraham' });
  });

  test('whole quiz: answer_norm for grouping, matches_reference, the parsed list, rule_matched, precedents of other runs only', async () => {
    const r = await request(base, 'GET', `/api/grading/${now.sessionId}/quiz?filter=all`, adminToken);
    assert.equal(r.status, 200);
    assert.equal(r.body.viewer.kind, 'admin');
    const q = r.body.questions[0];
    assert.deepEqual(q.question.accepted_answers, ['Ishmael']);
    assert.equal(q.stats.rule_matched, 1);
    const byText = Object.fromEntries(q.answers.map((a: { text_answer: string }) => [a.text_answer, a]));
    assert.equal(byText.Ismael.answer_norm, byText.ISMAEL.answer_norm, 'identical answers share answer_norm');
    assert.equal(byText.yishmael.matches_reference, true);
    assert.equal(byText.yishmael.grade_source, 'rule');
    assert.equal(byText.Ismael.matches_reference, false);
    assert.deepEqual(q.question.precedents, {
      ismael: { points: [0.5, 1], n: 2 },
      izmail: { points: [1], n: 1 },
    });
    assert.deepEqual(findKeys(r.body, ['display_name', 'participant_id', 'keys']), []);

    const earlierView = await request(base, 'GET', `/api/grading/${earlier.sessionId}/quiz?filter=all`, adminToken);
    assert.deepEqual(earlierView.body.questions[0].question.precedents, {}, "this run's own grades are not precedents for it");
  });

  test('participant page: precedents of that participant only', async () => {
    const r = await request(base, 'GET', `/api/grading/${now.sessionId}/participants/${k.c.id}`, adminToken);
    assert.equal(r.status, 200);
    assert.equal(r.body.viewer.kind, 'admin');
    assert.deepEqual(r.body.items[0].question.precedents, { izmail: { points: [1], n: 1 } });
    assert.equal(r.body.items[0].answer.answer_norm, 'izmail');
    assert.equal(r.body.items[0].answer.matches_reference, false);
  });

  test('participants never see the rule result before their results page opens', async () => {
    const forbidden = ['is_correct', 'points_awarded', 'grade_source', 'graded_by', 'grade_version', 'answer_norm', 'accepted_answers', 'reference_answer', 'precedents', 'matches_reference'];
    for (const p of ['/api/my/session', '/api/my/quiz']) {
      const r = await request(base, 'GET', p, k.d.token);
      assert.equal(r.status, 200, p);
      assert.deepEqual(findKeys(r.body, forbidden), [], p);
    }
    assert.equal((await request(base, 'GET', '/api/my/results', k.d.token)).status, 400, 'results only after the session');
  });
});

describe('migrations', () => {
  const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8');

  function freshDb(): Database.Database {
    const mem = new Database(':memory:');
    mem.pragma('foreign_keys = ON');
    mem.exec(SCHEMA);
    runMigrations(mem);
    mem.prepare("INSERT INTO admins (username, password_hash) VALUES ('a', 'x')").run();
    return mem;
  }

  function dump(mem: Database.Database) {
    const tables = mem.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name").all() as { name: string; sql: string }[];
    const rows = Object.fromEntries(
      tables.filter((t) => t.sql?.startsWith('CREATE TABLE')).map((t) => [t.name, mem.prepare(`SELECT * FROM ${t.name}`).all()]),
    );
    return { tables, rows };
  }

  /** A database as S12 left it: the Chidon questions with S12's lists and notes, and some answers without answer_norm. */
  function s12State(): Database.Database {
    const mem = freshDb();
    const insertQuiz = mem.prepare('INSERT INTO quizzes (title, time_limit_seconds, created_by) VALUES (?, 60, 1)');
    const insertQuestion = mem.prepare(
      "INSERT INTO questions (quiz_id, sort_order, type, text, points, reference_answer, accepted_answers, grader_notes) VALUES (?, ?, 'text', ?, 1, ?, ?, ?)",
    );
    for (const { entries } of CHIDON_ANSWER_KEYS) {
      const quizId = Number(insertQuiz.run('Chidon').lastInsertRowid);
      entries.forEach((e, i) => insertQuestion.run(quizId, i, e.text, e.reference, JSON.stringify(e.s12.accepted), e.s12.notes ?? null));
    }
    const sessionId = Number(mem.prepare("INSERT INTO sessions (quiz_id, join_code) VALUES (1, 'MIGRAT')").run().lastInsertRowid);
    const pid = Number(mem.prepare("INSERT INTO participants (session_id, display_name) VALUES (?, 'P')").run(sessionId).lastInsertRowid);
    const insertAnswer = mem.prepare('INSERT INTO answers (session_id, question_id, participant_id, text_answer) VALUES (?, ?, ?, ?)');
    insertAnswer.run(sessionId, 1, pid, "The Giv'onites!");
    insertAnswer.run(sessionId, 2, pid, '   ');
    insertAnswer.run(sessionId, 3, pid, '?!');
    mem.prepare('UPDATE answers SET answer_norm = NULL').run();
    return mem;
  }

  test('running the migrations twice is a no-op; answer_norm and its index exist', () => {
    const mem = s12State();
    runMigrations(mem);
    const once = dump(mem);
    runMigrations(mem);
    assert.deepEqual(dump(mem), once);
    const cols = (mem.prepare('PRAGMA table_info(answers)').all() as { name: string }[]).map((c) => c.name);
    assert.ok(cols.includes('answer_norm'));
    const index = mem.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_answers_q_norm'").pluck().get() as string;
    assert.match(index, /answers\s*\(question_id, answer_norm\)/);
  });

  test('the answer_norm backfill fills non-blank answers once', () => {
    const mem = s12State();
    assert.equal(backfillAnswerNorms(mem), 2);
    assert.equal(backfillAnswerNorms(mem), 0);
    const norms = mem.prepare('SELECT text_answer, answer_norm FROM answers ORDER BY id').all();
    assert.deepEqual(norms, [
      { text_answer: "The Giv'onites!", answer_norm: 'givonites' },
      { text_answer: '   ', answer_norm: null },
      { text_answer: '?!', answer_norm: '' },
    ]);
  });

  test('the S13 short forms replace only lists and notes S12 wrote; a second run and edited lists stay', () => {
    const mem = s12State();
    // An author edited one list and one note before S13 arrived.
    mem.prepare("UPDATE questions SET accepted_answers = '[\"my own\"]' WHERE text = ?").run(CHIDON_5787_ANFAENGER_KEY[0].text);
    mem.prepare("UPDATE questions SET grader_notes = 'my note' WHERE text = ?").run(CHIDON_5787_FORTGESCHRITTENE_KEY[4].text);
    const extendedEntries = CHIDON_ANSWER_KEYS.map(({ entries }) =>
      entries.filter((e) => JSON.stringify(e.accepted) !== JSON.stringify(e.s12.accepted) || e.notes !== e.s12.notes).length,
    );
    const changed = backfillAnswerKeyShortForms(mem);
    // Anfänger 1 is the author's own list (its note is unchanged by S13), so one entry fewer there.
    assert.deepEqual(changed, [extendedEntries[0], extendedEntries[1] - 1, extendedEntries[2]]);
    assert.deepEqual(backfillAnswerKeyShortForms(mem), [0, 0, 0]);

    const q = (text: string) =>
      mem.prepare('SELECT accepted_answers, grader_notes FROM questions WHERE text = ?').get(text) as { accepted_answers: string; grader_notes: string | null };
    assert.equal(q(CHIDON_5787_ANFAENGER_KEY[0].text).accepted_answers, '["my own"]');
    assert.deepEqual(JSON.parse(q(CHIDON_5787_ANFAENGER_KEY[7].text).accepted_answers), ['Nach Ägypten', 'Ägypten', 'Aegypten']);
    assert.deepEqual(JSON.parse(q(CHIDON_5787_FORTGESCHRITTENE_KEY[9].text).accepted_answers), ['70', 'siebzig']);
    // Only spec-listed short forms and spellings of the same answer: no synonyms or partial forms.
    assert.equal(q(CHIDON_5787_FORTGESCHRITTENE_KEY[5].text).accepted_answers, '["Mit Aussatz (Zaraat)"]');
    assert.deepEqual(JSON.parse(q(CHIDON_5786_KEY[1].text).accepted_answers), ['Yishmael', 'Ishmael']);
    // Multi-item answers: no partial forms, a partial-credit sentence in the notes.
    const fortgeschritten5 = q(CHIDON_5787_FORTGESCHRITTENE_KEY[4].text);
    assert.equal(fortgeschritten5.grader_notes, 'my note', 'an edited note stays');
    const fortgeschritten7 = q(CHIDON_5787_FORTGESCHRITTENE_KEY[6].text);
    assert.equal(fortgeschritten7.grader_notes, 'Bamidbar 14,6-9. Teilantwort (nur einer der beiden genannt): die Prüfenden entscheiden über die Punkte.');
    assert.ok(!JSON.parse(fortgeschritten7.accepted_answers).some((x: string) => /^(Jehoschua|Kalev)$/.test(x)));
    assert.equal(q(CHIDON_5786_KEY[11].text).grader_notes, 'Partial answer (only one of the two named): the grader decides the points.');
    assert.match(q(CHIDON_5787_ANFAENGER_KEY[2].text).grader_notes!, /^Bereschit 37,9\. Teilantwort/);
    for (const { entries } of CHIDON_ANSWER_KEYS) for (const e of entries) assert.ok(!/0[.,]5/.test(e.notes ?? ''), 'notes set no points');

    // The S12 backfill on a database that never had keys writes the extended values directly.
    const fresh = freshDb();
    const quizId = Number(fresh.prepare("INSERT INTO quizzes (title, time_limit_seconds, created_by) VALUES ('Q', 60, 1)").run().lastInsertRowid);
    fresh.prepare("INSERT INTO questions (quiz_id, sort_order, type, text, points) VALUES (?, 0, 'text', ?, 1)").run(quizId, CHIDON_5787_ANFAENGER_KEY[0].text);
    backfillAnswerKeys(fresh);
    assert.deepEqual(backfillAnswerKeyShortForms(fresh), [0, 0, 0]);
    assert.deepEqual(JSON.parse(fresh.prepare('SELECT accepted_answers FROM questions').pluck().get() as string), [
      'Eine Rippe (Seite)',
      'Rippe',
      'eine Rippe',
      'Seite',
    ]);
  });

  test('every key list is clean (no normalized duplicates, within the limits) and has 30 / 10 / 10 entries', () => {
    assert.deepEqual(
      CHIDON_ANSWER_KEYS.map((k) => k.entries.length),
      [30, 10, 10],
    );
    for (const { entries } of CHIDON_ANSWER_KEYS) {
      for (const e of entries) assert.deepEqual(cleanAccepted(e.accepted), e.accepted, e.text);
    }
    // Answer keys of choice questions stay empty; reference answers of the keys normalize to something.
    for (const { entries } of CHIDON_ANSWER_KEYS) for (const e of entries) assert.notEqual(normalizeForMatch(e.reference), '');
  });
});
