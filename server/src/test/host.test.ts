import './env';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db';
import { createAdmin, createQuizFixture, join, login, request, startServer } from './helpers';

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

test('join codes are accepted in lower case, with spaces and hyphens', async () => {
  const fx = createQuizFixture(adminId, 'Tolerant quiz');
  const spaced = `${fx.joinCode.slice(0, 3).toLowerCase()} ${fx.joinCode.slice(3)}`;
  const hyphen = `${fx.joinCode.slice(0, 3)}-${fx.joinCode.slice(3).toLowerCase()}`;
  assert.equal((await join(base, ` ${spaced} `, 'Spaced')).status, 200);
  assert.equal((await join(base, hyphen, 'Hyphen')).status, 200);
});

test('locked joining stops new names but lets people already in rejoin', async () => {
  const fx = createQuizFixture(adminId, 'Lock quiz');
  const anna = await join(base, fx.joinCode, 'Anna');
  const lock = await request(base, 'PUT', `/api/sessions/${fx.sessionId}/joining`, adminToken, { locked: true });
  assert.equal(lock.status, 200);
  assert.equal(lock.body.session.joining_locked, 1);

  const newcomer = await join(base, fx.joinCode, 'Newcomer');
  assert.equal(newcomer.status, 403);
  assert.equal(newcomer.body.code, 'JOINING_LOCKED');

  const rejoin = await request(base, 'POST', '/api/join', undefined, {
    joinCode: fx.joinCode,
    displayName: 'Anna',
    rejoinSecret: anna.body.rejoinSecret,
  });
  assert.equal(rejoin.status, 200);
  assert.equal(rejoin.body.participant.id, anna.body.participant.id);

  // After "Allow rejoin" the name can be claimed from another device even while locked.
  await request(base, 'PUT', `/api/sessions/${fx.sessionId}/participants/${anna.body.participant.id}/allow-rejoin`, adminToken);
  assert.equal((await join(base, fx.joinCode, 'Anna')).status, 200);

  assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/joining`, adminToken, { locked: false })).status, 200);
  assert.equal((await join(base, fx.joinCode, 'Newcomer')).status, 200);
});

test('the joining toggle validates its input and refuses ended sessions', async () => {
  const fx = createQuizFixture(adminId, 'Toggle quiz');
  assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/joining`, adminToken, { locked: 'yes' })).status, 400);
  assert.equal((await request(base, 'PUT', '/api/sessions/999999/joining', adminToken, { locked: true })).status, 404);
  await request(base, 'PUT', `/api/sessions/${fx.sessionId}/end`, adminToken);
  const r = await request(base, 'PUT', `/api/sessions/${fx.sessionId}/joining`, adminToken, { locked: true });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'SESSION_ENDED');
});

test('GET /api/quizzes shows each quiz\'s open run; a run whose time is up is not shown', async () => {
  const fx = createQuizFixture(adminId, 'Badge quiz');
  const list = async () =>
    (await request(base, 'GET', '/api/quizzes', adminToken)).body.quizzes.find((q: { id: number }) => q.id === fx.quizId);
  assert.deepEqual((await list()).open_session, {
    id: fx.sessionId,
    status: 'pending',
    join_code: fx.joinCode,
    ends_at: null,
    joining_locked: 0,
  });
  assert.equal((await list()).open_session_id, undefined);
  await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, adminToken);
  assert.equal((await list()).open_session.status, 'active');
  db.prepare('UPDATE sessions SET ends_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), fx.sessionId);
  assert.equal((await list()).open_session, null);
});

test('GET /api/sessions/:id returns the quiz title, time limit and question count', async () => {
  const fx = createQuizFixture(adminId, 'Meta quiz');
  const r = await request(base, 'GET', `/api/sessions/${fx.sessionId}`, adminToken);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.quiz, { id: fx.quizId, title: 'Meta quiz', time_limit_seconds: 600, question_count: 2 });
});
