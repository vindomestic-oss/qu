import './env';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect, type Socket } from 'socket.io-client';
import { db } from '../db';
import { createAdmin, createQuizFixture, join, login, request, startServer } from './helpers';

// S15 clock offset: the server's clock travels with /api/my/session, /api/my/quiz, the admin's
// GET /api/sessions/:id and every session:update, so countdowns can correct a device clock that is
// off. Display only: the server keeps ending the session on its own clock.

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

function nextUpdate(s: Socket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no session:update within 2 s')), 2000);
    s.once('session:update', (p) => {
      clearTimeout(timer);
      resolve(p);
    });
  });
}

/** An ISO timestamp (with milliseconds) taken between `from` and `to`. */
function assertServerNow(value: unknown, from: number, to: number, where: string) {
  assert.equal(typeof value, 'string', `${where}: server_now is a string`);
  assert.match(value as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, `${where}: ISO-8601 UTC`);
  const t = Date.parse(value as string);
  assert.ok(t >= from && t <= to, `${where}: server_now ${value} lies within the request`);
}

test('/api/my/session and /api/my/quiz carry server_now; so does the admin session read', async () => {
  const fx = createQuizFixture(adminId, 'Clock quiz');
  const kid = await join(base, fx.joinCode, 'Clock Kid');
  let from = Date.now();
  const lobby = await request(base, 'GET', '/api/my/session', kid.body.token);
  assert.equal(lobby.status, 200);
  assertServerNow(lobby.body.server_now, from, Date.now(), '/api/my/session (lobby)');

  assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, adminToken)).status, 200);
  from = Date.now();
  const quiz = await request(base, 'GET', '/api/my/quiz', kid.body.token);
  assert.equal(quiz.status, 200);
  assertServerNow(quiz.body.server_now, from, Date.now(), '/api/my/quiz');

  from = Date.now();
  const host = await request(base, 'GET', `/api/sessions/${fx.sessionId}`, adminToken);
  assert.equal(host.status, 200);
  assertServerNow(host.body.server_now, from, Date.now(), 'GET /api/sessions/:id');
});

test('every session:update carries server_now: participants, admins and graders', async () => {
  const fx = createQuizFixture(adminId, 'Clock socket quiz');
  const kid = await join(base, fx.joinCode, 'Socket Kid');
  const link = await request(base, 'POST', `/api/sessions/${fx.sessionId}/grader-links`, adminToken, { label: 'Clock' });
  const grader = await request(base, 'POST', '/api/grader/exchange', undefined, { code: link.body.code, name: 'Rav K.' });
  assert.equal(grader.status, 200);

  const [p, a, g] = [await open(), await open(), await open()];
  assert.equal((await p.emitWithAck('session:join', { sessionId: fx.sessionId, token: kid.body.token })).ok, true);
  assert.equal((await a.emitWithAck('staff:join', { sessionId: fx.sessionId, token: adminToken })).ok, true);
  assert.equal((await g.emitWithAck('staff:join', { sessionId: fx.sessionId, token: grader.body.token })).ok, true);

  // Lock toggle, start and end: each broadcast is stamped at the moment it is sent.
  for (const [method, path, body, status] of [
    ['PUT', `/api/sessions/${fx.sessionId}/joining`, { locked: true }, 'pending'],
    ['PUT', `/api/sessions/${fx.sessionId}/start`, undefined, 'active'],
    ['PUT', `/api/sessions/${fx.sessionId}/end`, undefined, 'ended'],
  ] as const) {
    const waits = [nextUpdate(p), nextUpdate(a), nextUpdate(g)];
    const from = Date.now();
    assert.equal((await request(base, method, path, adminToken, body)).status, 200);
    const [forKid, forAdmin, forGrader] = await Promise.all(waits);
    const to = Date.now();
    for (const [who, payload] of [
      ['participant', forKid],
      ['admin', forAdmin],
      ['grader', forGrader],
    ] as const) {
      assert.equal(payload.status, status, `${who}: status ${status}`);
      assertServerNow(payload.server_now, from, to, `${who} session:update (${status})`);
    }
    assert.equal('join_code' in forGrader, false, 'graders still get no join code');
  }
});

test('the server stays authoritative: a session ends on the server clock, whatever a device shows', async () => {
  const fx = createQuizFixture(adminId, 'Clock end quiz');
  db.prepare('UPDATE quizzes SET time_limit_seconds = 1 WHERE id = ?').run(fx.quizId);
  const kid = await join(base, fx.joinCode, 'Late Kid');
  const p = await open();
  assert.equal((await p.emitWithAck('session:join', { sessionId: fx.sessionId, token: kid.body.token })).ok, true);
  const ended = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no ended update within 3 s')), 3000);
    p.on('session:update', (u) => {
      if (u.status === 'ended') {
        clearTimeout(timer);
        resolve(u);
      }
    });
  });
  assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, adminToken)).status, 200);
  const update = await ended;
  assert.ok(Date.parse(update.server_now as string) >= Date.parse(update.ends_at as string), 'ended at or after ends_at');
  // A save that a device with a slow clock still believes in time is refused.
  const late = await request(base, 'POST', `/api/my/answers/${fx.singleQuestionId}`, kid.body.token, {
    selected_choice_ids: [fx.correctChoiceId],
  });
  assert.equal(late.status, 400);
});
