import './env';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { io as connect, type Socket } from 'socket.io-client';
import { db } from '../db';
import { runMigrations } from '../db/migrate';
import { recoverActiveSessions, sweepDueSessions } from '../lib/sessionTimers';
import { revalidateRooms } from '../socket';
import { createAdmin, createQuizFixture, join, login, request, sign, startServer, type QuizFixture } from './helpers';

let base = '';
let close: () => Promise<void>;
let adminId: number;
let adminToken: string;
const sockets: Socket[] = [];

async function open(): Promise<Socket> {
  const s = connect(base, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', reject);
  });
  return s;
}

function waitFor<T>(s: Socket, event: string, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within ${ms} ms`)), ms);
    s.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  ({ base, close } = await startServer());
  adminId = createAdmin();
  adminToken = await login(base);
});

after(async () => {
  for (const s of sockets) s.disconnect();
  await close();
});

function setTimeLimit(fx: QuizFixture, seconds: number) {
  db.prepare('UPDATE quizzes SET time_limit_seconds = ? WHERE id = ?').run(seconds, fx.quizId);
}

test('a 1-second session ends on its own: everyone is submitted and every room hears it', async () => {
  const fx = createQuizFixture(adminId, 'Timer quiz');
  setTimeLimit(fx, 1);
  const kid = await join(base, fx.joinCode, 'Timer Kid');
  const participantSocket = await open();
  const staffSocket = await open();
  assert.equal((await participantSocket.emitWithAck('session:join', { sessionId: fx.sessionId, token: kid.body.token })).ok, true);
  assert.equal((await staffSocket.emitWithAck('staff:join', { sessionId: fx.sessionId, token: adminToken })).ok, true);

  assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, adminToken)).status, 200);
  const ended = (p: { status: string }) => p.status === 'ended';
  const waitEnded = (s: Socket) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no ended update within 3 s')), 3000);
      s.on('session:update', (p: { status: string }) => {
        if (ended(p)) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  await Promise.all([waitEnded(participantSocket), waitEnded(staffSocket)]);

  const row = db.prepare('SELECT submitted_at, submit_source FROM participants WHERE id = ?').get(kid.body.participant.id) as {
    submitted_at: string | null;
    submit_source: string | null;
  };
  assert.ok(row.submitted_at);
  assert.equal(row.submit_source, 'session_end');
  const submit = await request(base, 'POST', '/api/my/submit', kid.body.token);
  assert.equal(submit.status, 200);
  assert.equal(submit.body.submitted_at, row.submitted_at);
});

test('session:live goes only to the staff room, at most about once per 500 ms', async () => {
  const fx = createQuizFixture(adminId, 'Live quiz');
  const kids = await Promise.all([1, 2, 3].map((i) => join(base, fx.joinCode, `Live Kid ${i}`)));
  const participantSockets = await Promise.all(kids.map(() => open()));
  for (const [i, s] of participantSockets.entries()) {
    assert.equal((await s.emitWithAck('session:join', { sessionId: fx.sessionId, token: kids[i].body.token })).ok, true);
  }
  const staff = await open();
  assert.equal((await staff.emitWithAck('staff:join', { sessionId: fx.sessionId, token: adminToken })).ok, true);
  // A participant token cannot enter the staff room.
  assert.equal((await participantSockets[0].emitWithAck('staff:join', { sessionId: fx.sessionId, token: kids[0].body.token })).ok, false);

  let participantLive = 0;
  for (const s of participantSockets) s.on('session:live', () => (participantLive += 1));
  let staffLive = 0;
  staff.on('session:live', () => (staffLive += 1));

  assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, adminToken)).status, 200);
  for (let round = 0; round < 4; round++) {
    await Promise.all(
      kids.map((k) =>
        request(base, 'POST', `/api/my/answers/${fx.singleQuestionId}`, k.body.token, {
          selected_choice_ids: [round % 2 ? fx.correctChoiceId : fx.wrongChoiceId],
        }),
      ),
    );
  }
  await sleep(700);
  assert.equal(participantLive, 0);
  assert.ok(staffLive >= 1 && staffLive <= 3, `staff got ${staffLive} session:live events for 12 saves`);
});

test('/live counts only the current run, and only real answers', async () => {
  const fx = createQuizFixture(adminId, 'Two runs quiz');
  // First run: two participants answer, then the run ends.
  const first = await Promise.all(['A', 'B'].map((n) => join(base, fx.joinCode, n)));
  await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, adminToken);
  for (const p of first) {
    await request(base, 'POST', `/api/my/answers/${fx.singleQuestionId}`, p.body.token, { selected_choice_ids: [fx.correctChoiceId] });
  }
  await request(base, 'PUT', `/api/sessions/${fx.sessionId}/end`, adminToken);

  // Second run of the same quiz: one participant, one real answer and one blank text answer.
  const second = await request(base, 'POST', `/api/quizzes/${fx.quizId}/sessions`, adminToken);
  assert.equal(second.status, 201);
  const kid = await join(base, second.body.session.join_code, 'C');
  await request(base, 'PUT', `/api/sessions/${second.body.session.id}/start`, adminToken);
  await request(base, 'POST', `/api/my/answers/${fx.singleQuestionId}`, kid.body.token, { selected_choice_ids: [] });
  await request(base, 'POST', `/api/my/answers/${fx.textQuestionId}`, kid.body.token, { text_answer: '   ' });

  const live = await request(base, 'GET', `/api/sessions/${second.body.session.id}/live`, adminToken);
  assert.equal(live.status, 200);
  assert.equal(live.body.participants.length, 1);
  assert.equal(live.body.participants[0].answered_count, 0);
  for (const q of live.body.questions) assert.equal(q.answered_count, 0, `question ${q.id}`);

  await request(base, 'POST', `/api/my/answers/${fx.singleQuestionId}`, kid.body.token, { selected_choice_ids: [fx.correctChoiceId] });
  const after = await request(base, 'GET', `/api/sessions/${second.body.session.id}/live`, adminToken);
  assert.equal(after.body.participants[0].answered_count, 1);
  assert.equal(after.body.questions.find((q: { id: number }) => q.id === fx.singleQuestionId).answered_count, 1);
});

test('saves after submit get 409; submit is idempotent', async () => {
  const fx = createQuizFixture(adminId, 'Submit quiz');
  const kid = await join(base, fx.joinCode, 'Submitter');
  await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, adminToken);
  const first = await request(base, 'POST', '/api/my/submit', kid.body.token);
  assert.equal(first.status, 200);
  const second = await request(base, 'POST', '/api/my/submit', kid.body.token);
  assert.equal(second.body.submitted_at, first.body.submitted_at);
  const save = await request(base, 'POST', `/api/my/answers/${fx.textQuestionId}`, kid.body.token, { text_answer: 'late' });
  assert.equal(save.status, 409);
  assert.equal(save.body.error, 'already_submitted');
  const source = db.prepare('SELECT submit_source FROM participants WHERE id = ?').get(kid.body.participant.id) as {
    submit_source: string;
  };
  assert.equal(source.submit_source, 'participant');
});

test('an unchanged text re-save writes nothing and emits nothing', async () => {
  const fx = createQuizFixture(adminId, 'Resave quiz');
  const kid = await join(base, fx.joinCode, 'Resaver');
  const staff = await open();
  await staff.emitWithAck('staff:join', { sessionId: fx.sessionId, token: adminToken });
  await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, adminToken);
  await request(base, 'POST', `/api/my/answers/${fx.textQuestionId}`, kid.body.token, { text_answer: 'abc' });
  const read = () =>
    db
      .prepare('SELECT grade_version, points_awarded, is_correct, submitted_at FROM answers WHERE participant_id = ? AND question_id = ?')
      .get(kid.body.participant.id, fx.textQuestionId);
  const before = read();
  await sleep(600); // let the live window from the first save close
  let live = 0;
  staff.on('session:live', () => (live += 1));
  for (const text of ['abc ', 'abc']) {
    const r = await request(base, 'POST', `/api/my/answers/${fx.textQuestionId}`, kid.body.token, { text_answer: text });
    assert.deepEqual(r.body, { ok: true });
  }
  await sleep(600);
  assert.deepEqual(read(), before);
  assert.equal(live, 0);
});

test('POST /api/quizzes/:id/sessions never returns a run whose time is up', async () => {
  const fx = createQuizFixture(adminId, 'Expired run quiz');
  await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, adminToken);
  db.prepare('UPDATE sessions SET ends_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), fx.sessionId);
  const r = await request(base, 'POST', `/api/quizzes/${fx.quizId}/sessions`, adminToken);
  assert.equal(r.status, 201);
  assert.notEqual(r.body.session.id, fx.sessionId);
  assert.equal((db.prepare('SELECT status FROM sessions WHERE id = ?').get(fx.sessionId) as { status: string }).status, 'ended');
});

test('on boot, a running session that expired meanwhile is ended and its participants submitted', () => {
  const fx = createQuizFixture(adminId, 'Boot quiz');
  const pid = Number(db.prepare("INSERT INTO participants (session_id, display_name) VALUES (?, 'Sleeper')").run(fx.sessionId).lastInsertRowid);
  const past = new Date(Date.now() - 60_000).toISOString();
  db.prepare("UPDATE sessions SET status = 'active', started_at = ?, ends_at = ? WHERE id = ?").run(past, past, fx.sessionId);
  recoverActiveSessions();
  assert.equal((db.prepare('SELECT status FROM sessions WHERE id = ?').get(fx.sessionId) as { status: string }).status, 'ended');
  const p = db.prepare('SELECT submitted_at, submit_source FROM participants WHERE id = ?').get(pid) as { submitted_at: string; submit_source: string };
  assert.equal(p.submit_source, 'session_end');
  assert.equal(p.submitted_at, past);
});

test('S5 backfills on an older database run once and are no-ops afterwards', () => {
  const legacy = new Database(':memory:');
  legacy.pragma('foreign_keys = ON');
  legacy.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'));
  // A database from before S5: participants.submitted_at existed (Finish button), the rest did not.
  legacy.exec('ALTER TABLE participants ADD COLUMN submitted_at TEXT');
  legacy.prepare("INSERT INTO admins (username, password_hash) VALUES ('a', 'x')").run();
  legacy.prepare("INSERT INTO quizzes (title, time_limit_seconds, created_by) VALUES ('Q', 60, 1)").run();
  legacy.prepare("INSERT INTO questions (quiz_id, sort_order, type, text) VALUES (1, 0, 'single', 'C'), (1, 1, 'text', 'T')").run();
  legacy.prepare("INSERT INTO sessions (quiz_id, join_code, status, ends_at) VALUES (1, 'AAAAAA', 'ended', '2026-10-01T10:00:00.000Z'), (1, 'BBBBBB', 'active', NULL)").run();
  legacy.prepare("INSERT INTO participants (session_id, display_name) VALUES (1, 'old'), (2, 'running')").run();
  legacy.prepare("INSERT INTO participants (session_id, display_name, submitted_at) VALUES (2, 'finished', '2026-10-01 09:00:00')").run();
  legacy
    .prepare(
      `INSERT INTO answers (session_id, question_id, participant_id, selected_choice_ids, text_answer, points_awarded, is_correct, graded_at)
       VALUES (1, 1, 1, '[1]', NULL, 1, 1, NULL), (1, 2, 1, NULL, '', 0, 0, NULL), (2, 2, 2, NULL, 'graded', 1, 1, '2026-10-01 09:30:00'),
              (2, 2, 3, NULL, 'resaved', NULL, NULL, '2026-10-01 09:40:00')`,
    )
    .run();
  runMigrations(legacy);
  const people = legacy.prepare('SELECT display_name, submitted_at, submit_source FROM participants ORDER BY id').all();
  assert.deepEqual(people, [
    { display_name: 'old', submitted_at: '2026-10-01T10:00:00.000Z', submit_source: 'session_end' },
    { display_name: 'running', submitted_at: null, submit_source: null },
    { display_name: 'finished', submitted_at: '2026-10-01 09:00:00', submit_source: 'participant' },
  ]);
  const grades = legacy.prepare('SELECT grade_source, graded_at, grade_version FROM answers ORDER BY id').all();
  assert.deepEqual(grades, [
    { grade_source: 'auto_choice', graded_at: null, grade_version: 0 },
    { grade_source: 'auto_blank', graded_at: null, grade_version: 0 },
    { grade_source: 'human', graded_at: '2026-10-01 09:30:00', grade_version: 0 },
    { grade_source: null, graded_at: null, grade_version: 0 },
  ]);
  const snapshot = () => JSON.stringify([legacy.prepare('SELECT * FROM participants').all(), legacy.prepare('SELECT * FROM answers').all()]);
  const beforeSecond = snapshot();
  runMigrations(legacy);
  assert.equal(snapshot(), beforeSecond);
});

test('the sweep ends overdue sessions; boot recovery re-arms a running one', async () => {
  const overdue = createQuizFixture(adminId, 'Sweep quiz');
  const past = new Date(Date.now() - 5000).toISOString();
  db.prepare("UPDATE sessions SET status = 'active', started_at = ?, ends_at = ? WHERE id = ?").run(past, past, overdue.sessionId);
  sweepDueSessions();
  assert.equal((db.prepare('SELECT status FROM sessions WHERE id = ?').get(overdue.sessionId) as { status: string }).status, 'ended');

  const running = createQuizFixture(adminId, 'Rearm quiz');
  const soon = new Date(Date.now() + 1200).toISOString();
  db.prepare("UPDATE sessions SET status = 'active', started_at = ?, ends_at = ? WHERE id = ?").run(soon, soon, running.sessionId);
  recoverActiveSessions();
  assert.equal((db.prepare('SELECT status FROM sessions WHERE id = ?').get(running.sessionId) as { status: string }).status, 'active');
  await sleep(1700);
  assert.equal((db.prepare('SELECT status FROM sessions WHERE id = ?').get(running.sessionId) as { status: string }).status, 'ended');
});

test('time limits above 7 days are refused', async () => {
  const r = await request(base, 'POST', '/api/quizzes', adminToken, { title: 'Too long', time_limit_seconds: 8 * 24 * 3600 });
  assert.equal(r.status, 400);
});

test('staff:join needs an existing session', async () => {
  const s = await open();
  const r = await s.emitWithAck('staff:join', { sessionId: 999999, token: adminToken });
  assert.equal(r.ok, false);
});

test('sockets lose rooms their token no longer allows', async () => {
  const fx = createQuizFixture(adminId, 'Revalidate quiz');
  // An admin token that expires in 1 s.
  const shortAdmin = sign({ role: 'admin', adminId, username: 'admin' }, undefined, { expiresIn: 1 });
  const staff = await open();
  assert.equal((await staff.emitWithAck('staff:join', { sessionId: fx.sessionId, token: shortAdmin })).ok, true);
  // A participant whose row is later claimed by another device.
  const kid = await join(base, fx.joinCode, 'Moved Kid');
  const kidSocket = await open();
  assert.equal((await kidSocket.emitWithAck('session:join', { sessionId: fx.sessionId, token: kid.body.token })).ok, true);
  await request(base, 'PUT', `/api/sessions/${fx.sessionId}/participants/${kid.body.participant.id}/allow-rejoin`, adminToken);
  assert.equal((await join(base, fx.joinCode, 'Moved Kid')).status, 200); // revalidates this session at once

  await sleep(1300);
  revalidateRooms(); // what the 30 s sweep does
  let staffGot = 0;
  let kidGot = 0;
  staff.on('session:update', () => (staffGot += 1));
  kidSocket.on('session:update', () => (kidGot += 1));
  await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, adminToken);
  await sleep(500);
  assert.equal(staffGot, 0, 'expired admin token still in the staff room');
  assert.equal(kidGot, 0, 'reclaimed participant still in the session room');
});
