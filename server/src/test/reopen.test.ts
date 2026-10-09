import './env';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect, type Socket } from 'socket.io-client';
import { db } from '../db';
import { createAdmin, createQuizFixture, join, login, request, sign, startServer, type QuizFixture } from './helpers';

// S15 admin "Reopen submission" (wishes 8 and 10): POST /api/sessions/:id/participants/:pid/reopen.

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

async function open(): Promise<Socket> {
  const s = connect(base, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', reject);
  });
  return s;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function started(title: string): Promise<QuizFixture> {
  const fx = createQuizFixture(adminId, title);
  assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, adminToken)).status, 200);
  return fx;
}

/** Joins, answers the text question, submits. */
async function submittedKid(fx: QuizFixture, name: string, text = 'The Danube') {
  const joined = await join(base, fx.joinCode, name);
  assert.equal(joined.status, 200);
  const token = joined.body.token as string;
  assert.equal((await request(base, 'POST', `/api/my/answers/${fx.textQuestionId}`, token, { text_answer: text })).status, 200);
  assert.equal((await request(base, 'POST', '/api/my/submit', token)).status, 200);
  return { token, id: joined.body.participant.id as number };
}

function participantRow(id: number) {
  return db.prepare('SELECT submitted_at, submit_source FROM participants WHERE id = ?').get(id) as {
    submitted_at: string | null;
    submit_source: string | null;
  };
}

function reopenEvents(participantId: number) {
  return db
    .prepare("SELECT session_id, participant_id, answer_id, question_id, actor, action, created_at FROM grade_events WHERE participant_id = ? AND action = 'reopen_submission'")
    .all(participantId) as { session_id: number; participant_id: number; answer_id: number | null; question_id: number | null; actor: string; action: string; created_at: string }[];
}

const reopenPath = (fx: QuizFixture, pid: number) => `/api/sessions/${fx.sessionId}/participants/${pid}/reopen`;

describe('who may reopen', () => {
  test('only admins: no token 401, participant and grader tokens 403, nothing changes', async () => {
    const fx = await started('Reopen auth quiz');
    const kid = await submittedKid(fx, 'Auth Kid');
    const link = await request(base, 'POST', `/api/sessions/${fx.sessionId}/grader-links`, adminToken, {});
    const grader = await request(base, 'POST', '/api/grader/exchange', undefined, { code: link.body.code, name: 'Rav K.' });
    assert.equal(grader.status, 200);
    const before = participantRow(kid.id);

    const variants: [string, string | undefined, number, string][] = [
      ['no token', undefined, 401, 'AUTH_REQUIRED'],
      ['the participant itself', kid.token, 403, 'FORBIDDEN'],
      ['a grader of this session', grader.body.token, 403, 'FORBIDDEN'],
      ['a forged admin token', sign({ role: 'admin', adminId, username: 'admin' }, 'another-secret'), 401, 'INVALID_TOKEN'],
    ];
    for (const [name, token, status, code] of variants) {
      const r = await request(base, 'POST', reopenPath(fx, kid.id), token);
      assert.equal(r.status, status, name);
      assert.equal(r.body.code, code, name);
    }
    assert.deepEqual(participantRow(kid.id), before, 'still submitted');
    assert.equal(reopenEvents(kid.id).length, 0, 'no audit row');
  });
});

describe('state rules', () => {
  test('a pending session: 400 SESSION_NOT_ACTIVE', async () => {
    const fx = createQuizFixture(adminId, 'Reopen pending quiz');
    const joined = await join(base, fx.joinCode, 'Lobby Kid');
    const r = await request(base, 'POST', reopenPath(fx, joined.body.participant.id), adminToken);
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'SESSION_NOT_ACTIVE');
  });

  test('an ended session: 400 SESSION_ENDED, the submission stays', async () => {
    const fx = await started('Reopen ended quiz');
    const kid = await submittedKid(fx, 'Ended Kid');
    assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/end`, adminToken)).status, 200);
    const r = await request(base, 'POST', reopenPath(fx, kid.id), adminToken);
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'SESSION_ENDED');
    assert.ok(participantRow(kid.id).submitted_at);
    assert.equal(reopenEvents(kid.id).length, 0);
  });

  test('a session whose time has run out counts as ended', async () => {
    const fx = await started('Reopen expired quiz');
    const kid = await submittedKid(fx, 'Expired Kid');
    db.prepare('UPDATE sessions SET ends_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), fx.sessionId);
    const r = await request(base, 'POST', reopenPath(fx, kid.id), adminToken);
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'SESSION_ENDED');
    assert.ok(participantRow(kid.id).submitted_at);
  });

  test('unknown participant or one of another session: 404', async () => {
    const fx = await started('Reopen 404 quiz');
    const other = await started('Reopen other quiz');
    const stranger = await submittedKid(other, 'Stranger');
    assert.equal((await request(base, 'POST', reopenPath(fx, 999_999), adminToken)).status, 404);
    assert.equal((await request(base, 'POST', reopenPath(fx, stranger.id), adminToken)).status, 404);
    assert.equal((await request(base, 'POST', `/api/sessions/999999/participants/${stranger.id}/reopen`, adminToken)).status, 404);
    assert.ok(participantRow(stranger.id).submitted_at, 'the other session is untouched');
  });

  test('a participant who has not submitted: 200 reopened:false, nothing written', async () => {
    const fx = await started('Reopen idle quiz');
    const joined = await join(base, fx.joinCode, 'Busy Kid');
    const r = await request(base, 'POST', reopenPath(fx, joined.body.participant.id), adminToken);
    assert.equal(r.status, 200);
    assert.equal(r.body.reopened, false);
    assert.equal(reopenEvents(joined.body.participant.id).length, 0);
  });
});

describe('reopening', () => {
  test('clears the submission, audits it, locks grading until the next Finish; grades survive an unchanged re-save', async () => {
    const fx = await started('Reopen main quiz');
    const kid = await submittedKid(fx, 'Main Kid', 'abc');
    // A grader grades the text answer while the participant is submitted.
    const quiz = await request(base, 'GET', `/api/grading/${fx.sessionId}/participants/${kid.id}`, adminToken);
    const item = quiz.body.items.find((i: { question: { id: number } }) => i.question.id === fx.textQuestionId);
    const graded = await request(base, 'PUT', `/api/grading/${fx.sessionId}/answers/${item.answer.id}`, adminToken, {
      is_correct: true,
      points_awarded: 2,
      expected_version: item.answer.grade_version,
    });
    assert.equal(graded.status, 200);

    const r = await request(base, 'POST', reopenPath(fx, kid.id), adminToken);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { participant: { id: kid.id, submitted_at: null, submit_source: null }, reopened: true });
    assert.deepEqual(participantRow(kid.id), { submitted_at: null, submit_source: null });
    const events = reopenEvents(kid.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].session_id, fx.sessionId);
    assert.equal(events[0].actor, 'admin:admin');
    assert.equal(events[0].answer_id, null);
    assert.equal(events[0].question_id, null);
    assert.match(events[0].created_at, /^\d{4}-\d{2}-\d{2}T/);

    // A second click changes nothing.
    const again = await request(base, 'POST', reopenPath(fx, kid.id), adminToken);
    assert.equal(again.body.reopened, false);
    assert.equal(reopenEvents(kid.id).length, 1);

    // Graders see the participant as not submitted: no grading, status "answering".
    const summary = await request(base, 'GET', `/api/grading/${fx.sessionId}/summary`, adminToken);
    const row = summary.body.participants.find((p: { id: number }) => p.id === kid.id);
    assert.equal(row.status, 'answering');
    const review = await request(base, 'GET', `/api/grading/${fx.sessionId}/participants/${kid.id}`, adminToken);
    assert.equal(review.body.gradable, false);
    const locked = await request(base, 'PUT', `/api/grading/${fx.sessionId}/answers/${item.answer.id}`, adminToken, {
      is_correct: false,
      points_awarded: 0,
      expected_version: graded.body.answer.grade_version,
    });
    assert.equal(locked.status, 409);
    assert.equal(locked.body.error, 'not_submitted');

    // The participant can save again. An unchanged re-save (focus and blur) keeps the grade (wish 10).
    for (const text of ['abc ', 'abc']) {
      assert.equal((await request(base, 'POST', `/api/my/answers/${fx.textQuestionId}`, kid.token, { text_answer: text })).status, 200);
    }
    const kept = db.prepare('SELECT points_awarded, is_correct FROM answers WHERE id = ?').get(item.answer.id) as {
      points_awarded: number | null;
      is_correct: number | null;
    };
    assert.deepEqual(kept, { points_awarded: 2, is_correct: 1 });
    // A changed answer must be graded again.
    assert.equal((await request(base, 'POST', `/api/my/answers/${fx.textQuestionId}`, kid.token, { text_answer: 'The Rhine' })).status, 200);
    assert.equal((db.prepare('SELECT points_awarded FROM answers WHERE id = ?').get(item.answer.id) as { points_awarded: number | null }).points_awarded, null);

    // Finish again: submitted by the participant, gradable again.
    const submit = await request(base, 'POST', '/api/my/submit', kid.token);
    assert.equal(submit.status, 200);
    assert.equal(participantRow(kid.id).submit_source, 'participant');
    assert.equal((await request(base, 'GET', `/api/grading/${fx.sessionId}/participants/${kid.id}`, adminToken)).body.gradable, true);
  });

  test('a reopened participant who never presses Finish is submitted by the session end', async () => {
    const fx = await started('Reopen end quiz');
    const kid = await submittedKid(fx, 'Forgetful Kid');
    assert.equal((await request(base, 'POST', reopenPath(fx, kid.id), adminToken)).body.reopened, true);
    assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/end`, adminToken)).status, 200);
    const row = participantRow(kid.id);
    assert.ok(row.submitted_at);
    assert.equal(row.submit_source, 'session_end');
  });
});

describe('live events', () => {
  test("only that participant's page hears submission:reopened; staff get grading:changed and session:live", async () => {
    const fx = await started('Reopen socket quiz');
    const kid = await submittedKid(fx, 'Socket Kid');
    const other = await submittedKid(fx, 'Other Kid');
    const [kidSocket, kidSecondTab, otherSocket, staff] = [await open(), await open(), await open(), await open()];
    for (const [s, token] of [
      [kidSocket, kid.token],
      [kidSecondTab, kid.token],
      [otherSocket, other.token],
    ] as const) {
      assert.equal((await s.emitWithAck('session:join', { sessionId: fx.sessionId, token })).ok, true);
    }
    assert.equal((await staff.emitWithAck('staff:join', { sessionId: fx.sessionId, token: adminToken })).ok, true);

    const got: Record<string, unknown[]> = { kid: [], kid2: [], other: [], staffReopened: [], grading: [], live: [] };
    kidSocket.on('submission:reopened', (p) => got.kid.push(p));
    kidSecondTab.on('submission:reopened', (p) => got.kid2.push(p));
    otherSocket.on('submission:reopened', (p) => got.other.push(p));
    staff.on('submission:reopened', (p) => got.staffReopened.push(p));
    staff.on('grading:changed', (p) => got.grading.push(p));
    staff.on('session:live', () => got.live.push(1));

    assert.equal((await request(base, 'POST', reopenPath(fx, kid.id), adminToken)).status, 200);
    // session:live is coalesced to one per 500 ms (the submits above opened a window).
    await sleep(700);
    assert.deepEqual(got.kid, [{ sessionId: fx.sessionId }]);
    assert.deepEqual(got.kid2, [{ sessionId: fx.sessionId }], 'every open tab of that participant');
    assert.deepEqual(got.other, [], 'other participants hear nothing');
    assert.deepEqual(got.staffReopened, [], 'the event is not a room broadcast');
    assert.deepEqual(got.grading, [{ kind: 'submit', participantId: kid.id }]);
    assert.ok(got.live.length >= 1, 'the live monitor refreshes');

    // A socket whose participant row was reclaimed elsewhere (token_version) no longer gets it.
    const kid3 = await submittedKid(fx, 'Reclaimed Kid');
    const stale = await open();
    assert.equal((await stale.emitWithAck('session:join', { sessionId: fx.sessionId, token: kid3.token })).ok, true);
    db.prepare('UPDATE participants SET token_version = token_version + 1 WHERE id = ?').run(kid3.id);
    const staleGot: unknown[] = [];
    stale.on('submission:reopened', (p) => staleGot.push(p));
    assert.equal((await request(base, 'POST', reopenPath(fx, kid3.id), adminToken)).status, 200);
    await sleep(300);
    assert.deepEqual(staleGot, []);
  });
});
