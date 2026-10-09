import './env';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { io as connect, type Socket } from 'socket.io-client';
import { db } from '../db';
import { backfillAnswerKeys, runMigrations } from '../db/migrate';
import { CHIDON_5786_KEY, CHIDON_5787_ANFAENGER_KEY, CHIDON_5787_FORTGESCHRITTENE_KEY } from '../db/chidonAnswerKey';
import { participantStatus } from '../lib/grading';
import { createAdmin, createQuizFixture, findKeys, join, login, request, sign, startServer, type QuizFixture } from './helpers';

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

async function createLink(sessionId: number, body: object = { label: 'Rav K.' }) {
  const r = await request(base, 'POST', `/api/sessions/${sessionId}/grader-links`, adminToken, body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as { link: { id: number; expires_at: string }; code: string; url: string };
}

async function exchange(code: string, name = 'Rav K.') {
  return request(base, 'POST', '/api/grader/exchange', undefined, { code, name });
}

async function graderFor(sessionId: number, name = 'Rav K.') {
  const link = await createLink(sessionId);
  const r = await exchange(link.code, name);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { token: r.body.token as string, linkId: link.link.id, code: link.code };
}

async function startedFixture(title: string): Promise<QuizFixture> {
  const fx = createQuizFixture(adminId, title);
  assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, adminToken)).status, 200);
  return fx;
}

/** Joins, answers the text question (and optionally the choice one), optionally submits. */
async function participant(fx: QuizFixture, name: string, opts: { text?: string; choice?: number; submit?: boolean } = {}) {
  const joined = await join(base, fx.joinCode, name);
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  const token = joined.body.token as string;
  if (opts.text !== undefined) {
    assert.equal((await request(base, 'POST', `/api/my/answers/${fx.textQuestionId}`, token, { text_answer: opts.text })).status, 200);
  }
  if (opts.choice !== undefined) {
    assert.equal(
      (await request(base, 'POST', `/api/my/answers/${fx.singleQuestionId}`, token, { selected_choice_ids: [opts.choice] })).status,
      200,
    );
  }
  if (opts.submit) assert.equal((await request(base, 'POST', '/api/my/submit', token)).status, 200);
  return { token, id: joined.body.participant.id as number };
}

function answerRow(participantId: number, questionId: number) {
  return db
    .prepare(
      'SELECT id, is_correct, points_awarded, graded_at, graded_by, graded_by_link_id, grade_source, grade_version FROM answers WHERE participant_id = ? AND question_id = ?',
    )
    .get(participantId, questionId) as {
    id: number;
    is_correct: number | null;
    points_awarded: number | null;
    graded_at: string | null;
    graded_by: string | null;
    graded_by_link_id: number | null;
    grade_source: string | null;
    grade_version: number;
  };
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

describe('grader links and the code exchange', () => {
  let fx: QuizFixture;
  before(async () => {
    fx = await startedFixture('Links quiz');
  });

  test('a link has a 16-character code shown once; the database keeps only its hash', async () => {
    const link = await createLink(fx.sessionId, { label: 'Miriam G.', expires_in_days: 1 });
    assert.match(link.code, /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
    assert.ok(link.url.endsWith(`/g/${link.code.replace(/-/g, '')}`));
    const row = db.prepare('SELECT * FROM grader_links WHERE id = ?').get(link.link.id) as Record<string, unknown>;
    assert.notEqual(row.code_hash, link.code.replace(/-/g, ''));
    assert.ok(!JSON.stringify(row).includes(link.code.replace(/-/g, '')));
    // Valid for 1 day after the session's end (still ahead), as ISO.
    const ends = Date.parse((db.prepare('SELECT ends_at FROM sessions WHERE id = ?').get(fx.sessionId) as { ends_at: string }).ends_at);
    assert.equal(Date.parse(link.link.expires_at), ends + 24 * 3600 * 1000);

    const list = await request(base, 'GET', `/api/sessions/${fx.sessionId}/grader-links`, adminToken);
    assert.equal(list.status, 200);
    assert.deepEqual(findKeys(list.body, ['code_hash', 'code']), []);
    assert.ok(list.body.links.some((l: { id: number; label: string }) => l.id === link.link.id && l.label === 'Miriam G.'));
  });

  test('PUBLIC_BASE_URL decides the link origin', async () => {
    process.env.PUBLIC_BASE_URL = 'https://quiz.example.org/';
    try {
      const link = await createLink(fx.sessionId);
      assert.ok(link.url.startsWith('https://quiz.example.org/g/'), link.url);
    } finally {
      delete process.env.PUBLIC_BASE_URL;
    }
  });

  test('bad link bodies are refused', async () => {
    for (const body of [{ expires_in_days: 3 }, { label: 'x'.repeat(61) }, { label: 5 }]) {
      const r = await request(base, 'POST', `/api/sessions/${fx.sessionId}/grader-links`, adminToken, body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
  });

  test('the exchange accepts the code in any case and with or without dashes; a wrong code is 401', async () => {
    const link = await createLink(fx.sessionId);
    const r = await exchange(link.code.toLowerCase().replace(/-/g, ' '));
    assert.equal(r.status, 200);
    assert.equal(r.body.session_id, fx.sessionId);
    assert.equal(r.body.quiz_title, 'Links quiz');
    const payload = JSON.parse(Buffer.from(r.body.token.split('.')[1], 'base64url').toString());
    assert.equal(payload.role, 'grader');
    assert.ok(payload.exp - payload.iat <= 12 * 3600);

    const wrong = await exchange('AAAA-BBBB-CCCC-DDDD');
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error, 'invalid_or_expired_code');
    assert.equal((await exchange(link.code, '   ')).status, 400);
    assert.equal((await exchange(link.code, 'x'.repeat(41))).status, 400);
  });

  test('an expired link (one minute ago, same UTC day) cannot be exchanged and its token stops working', async () => {
    const link = await createLink(fx.sessionId);
    const token = (await exchange(link.code)).body.token as string;
    assert.equal((await request(base, 'GET', `/api/grading/${fx.sessionId}/summary`, token)).status, 200);
    db.prepare('UPDATE grader_links SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 60_000).toISOString(), link.link.id);
    assert.equal((await exchange(link.code)).status, 401);
    const r = await request(base, 'GET', `/api/grading/${fx.sessionId}/summary`, token);
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'INVALID_TOKEN');
  });

  test('a token issued before its link existed (database wiped, ids reused) is refused', async () => {
    const link = await createLink(fx.sessionId);
    const stale = sign({ role: 'grader', sessionId: fx.sessionId, linkId: link.link.id, graderName: 'Old', iat: Math.floor(Date.now() / 1000) - 3600 });
    assert.equal((await request(base, 'GET', `/api/grading/${fx.sessionId}/summary`, stale)).status, 401);
  });

  test('grading paths send no Referer, are not indexed and not cached', async () => {
    const { token } = await graderFor(fx.sessionId);
    const res = await fetch(`${base}/api/grading/${fx.sessionId}/summary`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const page = await fetch(`${base}/g/ABCDEFGHJKLMNPQR`);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
  });
});

describe('grader scope', () => {
  let a: QuizFixture;
  let b: QuizFixture;
  let grader: { token: string; linkId: number };

  before(async () => {
    a = await startedFixture('Scope A');
    b = await startedFixture('Scope B');
    grader = await graderFor(a.sessionId);
  });

  test('a grader token works for its own session only', async () => {
    assert.equal((await request(base, 'GET', `/api/grading/${a.sessionId}/summary`, grader.token)).status, 200);
    const other = await request(base, 'GET', `/api/grading/${b.sessionId}/summary`, grader.token);
    assert.equal(other.status, 403);
    assert.equal(other.body.code, 'FORBIDDEN');
    assert.equal((await request(base, 'GET', `/api/grading/${b.sessionId}/quiz`, grader.token)).status, 403);
  });

  test('a grader token gets 403 on admin and participant routes and changes nothing', async () => {
    for (const [method, path] of [
      ['GET', '/api/quizzes'],
      ['GET', `/api/quizzes/${a.quizId}`],
      ['PUT', `/api/sessions/${a.sessionId}/end`],
      ['PUT', `/api/sessions/${a.sessionId}/start`],
      ['GET', `/api/sessions/${a.sessionId}/results`],
      ['POST', `/api/sessions/${a.sessionId}/grader-links`],
      ['GET', `/api/sessions/${a.sessionId}/grader-links`],
      ['DELETE', `/api/sessions/${a.sessionId}/grader-links/${grader.linkId}`],
      ['GET', '/api/admin/backups'],
      ['GET', '/api/auth/me'],
      ['GET', '/api/my/session'],
    ] as const) {
      const r = await request(base, method, path, grader.token, method === 'GET' || method === 'DELETE' ? undefined : {});
      assert.equal(r.status, 403, `${method} ${path}`);
    }
    assert.equal((db.prepare('SELECT status FROM sessions WHERE id = ?').get(a.sessionId) as { status: string }).status, 'active');
    assert.equal((db.prepare('SELECT revoked_at FROM grader_links WHERE id = ?').get(grader.linkId) as { revoked_at: null }).revoked_at, null);
  });

  test('a participant token gets 403 on the grading API; staff:join refuses it', async () => {
    const kid = await participant(a, 'Scope Kid');
    const r = await request(base, 'GET', `/api/grading/${a.sessionId}/summary`, kid.token);
    assert.equal(r.status, 403);
    const s = await openSocket();
    assert.equal((await s.timeout(2000).emitWithAck('staff:join', { sessionId: a.sessionId, token: kid.token })).ok, false);
  });

  test('staff:join accepts a grader for its own session only', async () => {
    const s = await openSocket();
    assert.equal((await s.timeout(2000).emitWithAck('staff:join', { sessionId: b.sessionId, token: grader.token })).ok, false);
    assert.equal((await s.timeout(2000).emitWithAck('staff:join', { sessionId: a.sessionId, token: grader.token })).ok, true);
    // ... and never the participants' room.
    assert.equal((await s.timeout(2000).emitWithAck('session:join', { sessionId: a.sessionId, token: grader.token })).ok, false);
  });

  test('a missing session is 404 for an admin', async () => {
    assert.equal((await request(base, 'GET', '/api/grading/987654/summary', adminToken)).status, 404);
  });
});

describe('revocation', () => {
  test('after revoke the next request is 401 and the open panel is disconnected within 1 s', async () => {
    const fx = await startedFixture('Revoke quiz');
    const grader = await graderFor(fx.sessionId);
    const s = await openSocket();
    assert.equal((await s.timeout(2000).emitWithAck('staff:join', { sessionId: fx.sessionId, token: grader.token })).ok, true);
    const disconnected = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the grader socket was not disconnected within 1 s')), 1000);
      s.once('disconnect', () => {
        clearTimeout(timer);
        resolve(Date.now());
      });
    });

    const revokedAt = Date.now();
    const del = await request(base, 'DELETE', `/api/sessions/${fx.sessionId}/grader-links/${grader.linkId}`, adminToken);
    assert.equal(del.status, 200);
    assert.ok(del.body.link.revoked_at);
    const r = await request(base, 'GET', `/api/grading/${fx.sessionId}/summary`, grader.token);
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'INVALID_TOKEN');
    assert.ok((await disconnected) - revokedAt < 1000);

    // The code no longer works, and joining the staff room again is refused.
    assert.equal((await exchange(grader.code)).status, 401);
    const again = await openSocket();
    assert.equal((await again.timeout(2000).emitWithAck('staff:join', { sessionId: fx.sessionId, token: grader.token })).ok, false);
  });

  test('revoking an unknown link is 404', async () => {
    const fx = createQuizFixture(adminId, 'Revoke 404');
    assert.equal((await request(base, 'DELETE', `/api/sessions/${fx.sessionId}/grader-links/424242`, adminToken)).status, 404);
  });
});

describe('grading writes', () => {
  let fx: QuizFixture;
  let grader: { token: string; linkId: number };
  let submitted: { token: string; id: number };
  let answering: { token: string; id: number };

  before(async () => {
    fx = await startedFixture('Grading quiz');
    grader = await graderFor(fx.sessionId, 'Miriam G.');
    submitted = await participant(fx, 'Done Kid', { text: 'Mass attracts mass', choice: fx.wrongChoiceId, submit: true });
    answering = await participant(fx, 'Busy Kid', { text: 'Still typing' });
  });

  const put = (token: string, answerId: number, body: object) =>
    request(base, 'PUT', `/api/grading/${fx.sessionId}/answers/${answerId}`, token, body);

  test('an answer of a participant who has not submitted is 409 not_submitted', async () => {
    const a = answerRow(answering.id, fx.textQuestionId);
    const r = await put(grader.token, a.id, { is_correct: true, points_awarded: 2, expected_version: a.grade_version });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'not_submitted');
    assert.equal(answerRow(answering.id, fx.textQuestionId).points_awarded, null);
  });

  test('a grade saves with ISO graded_at, version + 1 and an audit row', async () => {
    const a = answerRow(submitted.id, fx.textQuestionId);
    const r = await put(grader.token, a.id, { is_correct: false, points_awarded: 1.5, expected_version: a.grade_version });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.answer.points_awarded, 1.5);
    assert.equal(r.body.answer.is_correct, 0, 'the verdict comes from the request');
    assert.equal(r.body.answer.grade_version, a.grade_version + 1);
    assert.equal(r.body.answer.graded_by, 'Miriam G. (link #' + grader.linkId + ')');
    const stored = answerRow(submitted.id, fx.textQuestionId);
    assert.match(stored.graded_at!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(stored.grade_source, 'human');
    assert.equal(stored.graded_by_link_id, grader.linkId);
    const events = db.prepare('SELECT * FROM grade_events WHERE answer_id = ? ORDER BY id').all(a.id) as Record<string, unknown>[];
    assert.equal(events.length, 1);
    assert.equal(events[0].action, 'manual');
    assert.equal(events[0].old_points, null);
    assert.equal(events[0].new_points, 1.5);
    assert.equal(events[0].actor, stored.graded_by);
    assert.equal(events[0].session_id, fx.sessionId);
  });

  test('a stale expected_version is 409 conflict with the current grade, and nothing is overwritten', async () => {
    const a = answerRow(submitted.id, fx.textQuestionId);
    const r = await put(adminToken, a.id, { is_correct: true, points_awarded: 2, expected_version: a.grade_version - 1 });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'conflict');
    assert.deepEqual(r.body.current, {
      id: a.id,
      is_correct: 0,
      points_awarded: 1.5,
      graded_at: a.graded_at,
      graded_by: a.graded_by,
      grade_source: 'human',
      grade_version: a.grade_version,
    });
    assert.deepEqual(answerRow(submitted.id, fx.textQuestionId), a);
    // "Replace with mine" resends with the version from the conflict.
    const again = await put(adminToken, a.id, { is_correct: true, points_awarded: 2, expected_version: r.body.current.grade_version });
    assert.equal(again.status, 200);
    assert.equal(again.body.answer.graded_by, 'admin:admin');
    const events = db.prepare('SELECT old_points, new_points FROM grade_events WHERE answer_id = ? ORDER BY id').all(a.id);
    assert.deepEqual(events, [
      { old_points: null, new_points: 1.5 },
      { old_points: 1.5, new_points: 2 },
    ]);
  });

  test('points are whole or half and at most the question maximum', async () => {
    const a = answerRow(submitted.id, fx.textQuestionId);
    for (const points_awarded of [0.3, 2.5, -1, Number.NaN]) {
      const r = await put(adminToken, a.id, { is_correct: false, points_awarded, expected_version: a.grade_version });
      assert.equal(r.status, 400, String(points_awarded));
    }
    // source 'ai' became valid with wish 7 (S14); an unknown source is still refused.
    for (const body of [{ points_awarded: 1, expected_version: a.grade_version }, { is_correct: true, points_awarded: 1 }, { is_correct: true, points_awarded: 1, expected_version: a.grade_version, source: 'robot' }]) {
      assert.equal((await put(adminToken, a.id, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await put(adminToken, 999_999, { is_correct: true, points_awarded: 1, expected_version: 0 })).status, 404);
  });

  test('a choice answer can be overridden by hand', async () => {
    const a = answerRow(submitted.id, fx.singleQuestionId);
    assert.equal(a.grade_source, 'auto_choice');
    const r = await put(grader.token, a.id, { is_correct: true, points_awarded: 1, expected_version: a.grade_version });
    assert.equal(r.status, 200);
    assert.equal(answerRow(submitted.id, fx.singleQuestionId).grade_source, 'human');
  });

  test('an answer of another session is 404', async () => {
    const other = await startedFixture('Other grading quiz');
    const kid = await participant(other, 'Elsewhere', { text: 'x', submit: true });
    const a = answerRow(kid.id, other.textQuestionId);
    assert.equal((await put(adminToken, a.id, { is_correct: true, points_awarded: 1, expected_version: a.grade_version })).status, 404);
  });

  test('bulk-grade grades each item in one transaction and reports conflicts per item', async () => {
    const k1 = await participant(fx, 'Bulk One', { text: 'Yishmael', submit: true });
    const k2 = await participant(fx, 'Bulk Two', { text: 'Yishmael', submit: true });
    const a1 = answerRow(k1.id, fx.textQuestionId);
    const a2 = answerRow(k2.id, fx.textQuestionId);
    const busy = answerRow(answering.id, fx.textQuestionId);
    const r = await request(base, 'POST', `/api/grading/${fx.sessionId}/answers/bulk-grade`, grader.token, {
      is_correct: true,
      points_awarded: 2,
      items: [
        { answer_id: a1.id, expected_version: a1.grade_version },
        { answer_id: a2.id, expected_version: a2.grade_version + 5 },
        { answer_id: busy.id, expected_version: busy.grade_version },
      ],
    });
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.body.results.map((x: { id: number; ok: boolean; error?: string }) => [x.id, x.ok, x.error ?? null]),
      [
        [a1.id, true, null],
        [a2.id, false, 'conflict'],
        [busy.id, false, 'not_submitted'],
      ],
    );
    assert.equal(answerRow(k1.id, fx.textQuestionId).points_awarded, 2);
    assert.equal(answerRow(k2.id, fx.textQuestionId).points_awarded, null);
  });

  test('a grade reaches the staff room as grading:changed', async () => {
    const kid = await participant(fx, 'Socket Grade', { text: 'Gravity', submit: true });
    const s = await openSocket();
    assert.equal((await s.timeout(2000).emitWithAck('staff:join', { sessionId: fx.sessionId, token: adminToken })).ok, true);
    const got = new Promise<{ kind: string; answerIds: number[]; by: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no grading:changed within 1 s')), 1000);
      s.once('grading:changed', (p) => {
        clearTimeout(timer);
        resolve(p);
      });
    });
    const a = answerRow(kid.id, fx.textQuestionId);
    assert.equal((await put(grader.token, a.id, { is_correct: true, points_awarded: 2, expected_version: a.grade_version })).status, 200);
    assert.deepEqual(await got, { kind: 'grade', answerIds: [a.id], by: `Miriam G. (link #${grader.linkId})` });
  });

  test('the old grade endpoint is gone', async () => {
    const a = answerRow(submitted.id, fx.textQuestionId);
    const r = await request(base, 'PUT', `/api/sessions/${fx.sessionId}/answers/${a.id}/grade`, adminToken, { points_awarded: 1 });
    assert.equal(r.status, 404);
  });
});

describe('the staff room', () => {
  test('graders get session:update without the join code; admins keep it', async () => {
    const fx = createQuizFixture(adminId, 'Socket payload quiz');
    const grader = await graderFor(fx.sessionId);
    const g = await openSocket();
    const a = await openSocket();
    assert.equal((await g.timeout(2000).emitWithAck('staff:join', { sessionId: fx.sessionId, token: grader.token })).ok, true);
    assert.equal((await a.timeout(2000).emitWithAck('staff:join', { sessionId: fx.sessionId, token: adminToken })).ok, true);
    const next = (s: Socket) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no session:update within 1 s')), 1000);
        s.once('session:update', (p) => {
          clearTimeout(timer);
          resolve(p);
        });
      });
    const [gp, ap] = [next(g), next(a)];
    assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, adminToken)).status, 200);
    const [forGrader, forAdmin] = [await gp, await ap];
    assert.equal(forGrader.status, 'active');
    assert.equal('join_code' in forGrader, false);
    assert.equal(forAdmin.join_code, fx.joinCode);
  });
});

describe('regrades are audited', () => {
  test('changing a question\'s points writes regrade_points events for the grades it changed', async () => {
    const fx = await startedFixture('Regrade audit quiz');
    const kid = await participant(fx, 'Regrade Kid', { choice: fx.correctChoiceId, submit: true });
    const a = answerRow(kid.id, fx.singleQuestionId);
    assert.equal(a.points_awarded, 1);
    const quiz = await request(base, 'GET', `/api/quizzes/${fx.quizId}`, adminToken);
    const q = quiz.body.quiz.questions.find((x: { id: number }) => x.id === fx.singleQuestionId);
    const r = await request(base, 'PUT', `/api/questions/${fx.singleQuestionId}`, adminToken, {
      type: 'single',
      text: q.text,
      points: 2,
      choices: q.choices.map((c: { id: number; text: string; is_correct: number }) => ({ id: c.id, text: c.text, is_correct: Boolean(c.is_correct) })),
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.quiz.total_points, 4);
    assert.equal(answerRow(kid.id, fx.singleQuestionId).points_awarded, 2);
    const events = db
      .prepare('SELECT actor, action, old_points, new_points, old_is_correct, is_correct, grade_source FROM grade_events WHERE answer_id = ?')
      .all(a.id);
    assert.deepEqual(events, [
      { actor: 'admin:admin', action: 'regrade_points', old_points: 1, new_points: 2, old_is_correct: 1, is_correct: 1, grade_source: 'auto_choice' },
    ]);
  });

  test('lowering the points clamps a human grade but never flips the grader\'s verdict', async () => {
    const fx = await startedFixture('Regrade verdict quiz');
    const kid = await participant(fx, 'Verdict Kid', { text: 'half right', submit: true });
    const a = answerRow(kid.id, fx.textQuestionId);
    const g = await request(base, 'PUT', `/api/grading/${fx.sessionId}/answers/${a.id}`, adminToken, {
      is_correct: false,
      points_awarded: 1.5,
      expected_version: a.grade_version,
    });
    assert.equal(g.status, 200);
    const r = await request(base, 'PUT', `/api/questions/${fx.textQuestionId}`, adminToken, { type: 'text', text: 'Explain gravity.', points: 1 });
    assert.equal(r.status, 200);
    const after = answerRow(kid.id, fx.textQuestionId);
    assert.equal(after.points_awarded, 1);
    assert.equal(after.is_correct, 0, 'still "incorrect", as the grader decided');
    const events = db.prepare('SELECT action, old_points, new_points, old_is_correct, is_correct FROM grade_events WHERE answer_id = ? ORDER BY id').all(a.id);
    assert.deepEqual(events, [
      { action: 'manual', old_points: null, new_points: 1.5, old_is_correct: null, is_correct: 0 },
      { action: 'regrade_points', old_points: 1.5, new_points: 1, old_is_correct: 0, is_correct: 0 },
    ]);
  });

  test('the audit outlives a deleted question: answer_id becomes NULL, the other ids stay', async () => {
    const fx = await startedFixture('Audit survives quiz');
    const kid = await participant(fx, 'Audit Kid', { text: 'gone soon', submit: true });
    const a = answerRow(kid.id, fx.textQuestionId);
    assert.equal(
      (await request(base, 'PUT', `/api/grading/${fx.sessionId}/answers/${a.id}`, adminToken, { is_correct: true, points_awarded: 2, expected_version: a.grade_version })).status,
      200,
    );
    assert.equal((await request(base, 'DELETE', `/api/questions/${fx.textQuestionId}`, adminToken)).status, 200);
    assert.equal(db.prepare('SELECT 1 FROM answers WHERE id = ?').get(a.id), undefined);
    const rows = db.prepare('SELECT answer_id, session_id, question_id, participant_id, new_points FROM grade_events WHERE question_id = ?').all(fx.textQuestionId);
    assert.deepEqual(rows, [{ answer_id: null, session_id: fx.sessionId, question_id: fx.textQuestionId, participant_id: kid.id, new_points: 2 }]);
  });
});

describe('model answers in the editor', () => {
  test('text questions keep reference_answer and grader_notes; an absent key keeps the value; choice types clear them', async () => {
    const fx = createQuizFixture(adminId, 'Model answer quiz');
    const putText = (body: object) =>
      request(base, 'PUT', `/api/questions/${fx.textQuestionId}`, adminToken, { type: 'text', text: 'Explain gravity.', points: 2, ...body });
    const read = () =>
      db.prepare('SELECT reference_answer, grader_notes, accepted_answers FROM questions WHERE id = ?').get(fx.textQuestionId);
    assert.equal((await putText({ reference_answer: ' Mass attracts mass ', grader_notes: 'Accept "gravity pulls"' })).status, 200);
    assert.deepEqual(read(), { reference_answer: 'Mass attracts mass', grader_notes: 'Accept "gravity pulls"', accepted_answers: null });
    assert.equal((await putText({ points: 1.5 })).status, 200);
    assert.deepEqual(read(), { reference_answer: 'Mass attracts mass', grader_notes: 'Accept "gravity pulls"', accepted_answers: null });
    assert.equal((await putText({ reference_answer: 5 })).status, 400);

    db.prepare(`UPDATE questions SET reference_answer = 'x', accepted_answers = '["x"]', grader_notes = 'n' WHERE id = ?`).run(fx.singleQuestionId);
    const quiz = await request(base, 'GET', `/api/quizzes/${fx.quizId}`, adminToken);
    const q = quiz.body.quiz.questions.find((x: { id: number }) => x.id === fx.singleQuestionId);
    const r = await request(base, 'PUT', `/api/questions/${fx.singleQuestionId}`, adminToken, {
      type: 'single',
      text: q.text,
      points: 1,
      reference_answer: 'ignored',
      choices: q.choices.map((c: { id: number; text: string; is_correct: number }) => ({ id: c.id, text: c.text, is_correct: Boolean(c.is_correct) })),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(db.prepare('SELECT reference_answer, accepted_answers, grader_notes FROM questions WHERE id = ?').get(fx.singleQuestionId), {
      reference_answer: null,
      accepted_answers: null,
      grader_notes: null,
    });
  });

  test('an explicitly empty model answer on a new question is kept empty by the Chidon backfill', async () => {
    const created = await request(base, 'POST', '/api/quizzes', adminToken, { title: 'Empty key quiz', time_limit_seconds: 600 });
    const r = await request(base, 'POST', `/api/quizzes/${created.body.quiz.id}/questions`, adminToken, {
      type: 'text',
      text: CHIDON_5786_KEY[3].text,
      points: 1,
      reference_answer: '',
    });
    assert.equal(r.status, 201);
    const id = r.body.quiz.questions[0].id;
    assert.equal((db.prepare('SELECT reference_answer FROM questions WHERE id = ?').get(id) as { reference_answer: string | null }).reference_answer, '');
    backfillAnswerKeys(db);
    assert.equal((db.prepare('SELECT reference_answer FROM questions WHERE id = ?').get(id) as { reference_answer: string | null }).reference_answer, '');
  });

  test('a new text question stores its model answer; quizzes take default_points', async () => {
    const created = await request(base, 'POST', '/api/quizzes', adminToken, { title: 'Defaults quiz', time_limit_seconds: 600, default_points: 0.5 });
    assert.equal(created.status, 201);
    assert.equal(created.body.quiz.default_points, 0.5);
    const quizId = created.body.quiz.id;
    const q = await request(base, 'POST', `/api/quizzes/${quizId}/questions`, adminToken, {
      type: 'text',
      text: 'Who?',
      points: 0.5,
      reference_answer: 'Yishmael',
      grader_notes: 'Also Ishmael',
    });
    assert.equal(q.status, 201);
    assert.equal(q.body.quiz.questions[0].reference_answer, 'Yishmael');
    assert.equal(q.body.quiz.total_points, 0.5);
    assert.equal((await request(base, 'POST', '/api/quizzes', adminToken, { title: 'Bad', time_limit_seconds: 600, default_points: 0.3 })).status, 400);
    const kept = await request(base, 'PUT', `/api/quizzes/${quizId}`, adminToken, { title: 'Defaults quiz', time_limit_seconds: 600 });
    assert.equal(kept.body.quiz.default_points, 0.5);
    const changed = await request(base, 'PUT', `/api/quizzes/${quizId}`, adminToken, { title: 'Defaults quiz', time_limit_seconds: 600, default_points: 2 });
    assert.equal(changed.body.quiz.default_points, 2);
  });
});

describe('reading the panel', () => {
  let fx: QuizFixture;
  let grader: { token: string };
  const kids: { token: string; id: number }[] = [];

  before(async () => {
    fx = await startedFixture('Panel quiz');
    grader = await graderFor(fx.sessionId);
    // 6 submitted text answers (for the anonymous order), one blank, one still answering, one never answered.
    for (let i = 0; i < 6; i++) kids.push(await participant(fx, `Kid ${i + 1}`, { text: `answer ${i + 1}`, choice: i % 2 ? fx.correctChoiceId : fx.wrongChoiceId, submit: true }));
    kids.push(await participant(fx, 'Blank Kid', { text: '   ', submit: true }));
    kids.push(await participant(fx, 'Busy Kid', { text: 'typing…' }));
    kids.push(await participant(fx, 'Idle Kid'));
  });

  test('summary counts this run only, with statuses, and names for graders too (Q-names)', async () => {
    // The same quiz run again in another session must not count here.
    const otherSession = Number(db.prepare("INSERT INTO sessions (quiz_id, join_code, status) VALUES (?, 'ZZZZZZ', 'active')").run(fx.quizId).lastInsertRowid);
    const otherKid = Number(db.prepare("INSERT INTO participants (session_id, display_name, submitted_at) VALUES (?, 'Other run', ?)").run(otherSession, new Date().toISOString()).lastInsertRowid);
    db.prepare("INSERT INTO answers (session_id, question_id, participant_id, text_answer) VALUES (?, ?, ?, 'other run')").run(otherSession, fx.textQuestionId, otherKid);

    const r = await request(base, 'GET', `/api/grading/${fx.sessionId}/summary`, grader.token);
    assert.equal(r.status, 200);
    const c = r.body.counters;
    assert.equal(c.participants_joined, 9);
    assert.equal(c.participants_submitted, 7);
    assert.equal(c.participants_answering, 1);
    assert.equal(c.needs_review, 6);
    assert.equal(c.awaiting_submission, 1);
    assert.equal(c.correct, 3);
    assert.equal(c.incorrect, 3, 'the blank answer is not answered, so it is not in the bar');
    assert.equal(c.answers_given, 6 + 6 + 1);
    assert.equal(c.answers_possible, 9 * 2);
    assert.deepEqual(findKeys(r.body, ['joined_at']), []);
    assert.equal(r.body.participants[0].display_name, 'Kid 1', 'graders see names in the participant list');
    const statuses = Object.fromEntries(r.body.participants.map((p: { number: number; status: string }) => [p.number, p.status]));
    assert.deepEqual(statuses, { 1: 'needs_review', 2: 'needs_review', 3: 'needs_review', 4: 'needs_review', 5: 'needs_review', 6: 'needs_review', 7: 'graded', 8: 'answering', 9: 'not_started' });
    assert.equal(r.body.quiz.total_points, 3);
    assert.equal(r.body.viewer.kind, 'grader');

    const asAdmin = await request(base, 'GET', `/api/grading/${fx.sessionId}/summary`, adminToken);
    assert.equal(asAdmin.body.participants[0].display_name, 'Kid 1');
    const textRow = asAdmin.body.questions.find((q: { id: number }) => q.id === fx.textQuestionId);
    assert.equal(textRow.answered_count, 7);
    assert.equal(textRow.needs_review_count, 6);
    // Wish 8 (S15): graded_count is the denominator of correct_rate (the "difficult" badge).
    assert.equal(textRow.graded_count, 0);
    assert.equal(textRow.correct_rate, null);
    const choiceRow = asAdmin.body.questions.find((q: { id: number }) => q.id === fx.singleQuestionId);
    assert.equal(choiceRow.graded_count, 6);
    assert.equal(choiceRow.correct_rate, 0.5);
  });

  test('participant page: the name, gradable after submission, prev/next by join order', async () => {
    const first = await request(base, 'GET', `/api/grading/${fx.sessionId}/participants/${kids[0].id}`, grader.token);
    assert.equal(first.status, 200);
    assert.equal(first.body.participant.display_name, 'Kid 1', 'graders see the name on the participant page');
    assert.equal(first.body.participant.number, 1);
    assert.equal(first.body.gradable, true);
    assert.equal(first.body.prev_id, null);
    assert.equal(first.body.next_id, kids[1].id);
    const text = first.body.items.find((it: { question: { id: number } }) => it.question.id === fx.textQuestionId);
    assert.equal(text.answer.text_answer, 'answer 1');
    assert.ok('reference_answer' in text.question);

    const busy = await request(base, 'GET', `/api/grading/${fx.sessionId}/participants/${kids[7].id}`, adminToken);
    assert.equal(busy.body.gradable, false);
    assert.equal(busy.body.participant.display_name, 'Busy Kid');
    const blank = await request(base, 'GET', `/api/grading/${fx.sessionId}/participants/${kids[6].id}`, adminToken);
    assert.equal(blank.body.items.find((it: { question: { id: number } }) => it.question.id === fx.textQuestionId).answer, null);
    assert.equal((await request(base, 'GET', `/api/grading/${fx.sessionId}/participants/987654`, adminToken)).status, 404);
  });

  test('whole quiz: anonymous rows of submitted participants, labels not in join order', async () => {
    for (const token of [grader.token, adminToken]) {
      const r = await request(base, 'GET', `/api/grading/${fx.sessionId}/quiz?filter=all`, token);
      assert.equal(r.status, 200);
      assert.deepEqual(findKeys(r.body, ['display_name', 'participant_id', 'joined_at', 'participantId']), []);
      const text = r.body.questions.find((q: { question: { id: number } }) => q.question.id === fx.textQuestionId);
      assert.equal(text.answers.length, 6, 'blank and unsubmitted answers are not rows');
      assert.deepEqual(text.answers.map((a: { label: number }) => a.label), [1, 2, 3, 4, 5, 6]);
      const joinOrder = kids.slice(0, 6).map((k) => answerRow(k.id, fx.textQuestionId).id);
      assert.notDeepEqual(text.answers.map((a: { id: number }) => a.id), joinOrder, 'labels must not follow the join order');
      assert.equal(text.stats.not_submitted_participants, 2);
      assert.equal(text.stats.awaiting_submission, 1);
      assert.equal(text.stats.no_answer, 1);
      const choice = r.body.questions.find((q: { question: { id: number } }) => q.question.id === fx.singleQuestionId);
      assert.deepEqual(choice.stats.choice_counts, { [fx.correctChoiceId]: 3, [fx.wrongChoiceId]: 3 });
      // Graded answers and the correct ones among them (wish 8: the "difficult" badge).
      assert.deepEqual([text.stats.graded, text.stats.correct, choice.stats.graded, choice.stats.correct], [0, 0, 6, 3]);
      assert.deepEqual(r.body.progress, { graded: 0, total: 6 });
    }
  });

  test('answers?ids= returns the current grade of just those answers of this session', async () => {
    const ids = kids.slice(0, 2).map((k) => answerRow(k.id, fx.textQuestionId).id);
    const r = await request(base, 'GET', `/api/grading/${fx.sessionId}/answers?ids=${ids.join(',')},999999`, grader.token);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.answers.map((a: { id: number }) => a.id).sort((x: number, y: number) => x - y), [...ids].sort((x, y) => x - y));
    // Grade fields plus the AI suggestion (wish 7, S14); never the participant or the answer text.
    assert.deepEqual(
      Object.keys(r.body.answers[0]).sort(),
      ['graded_at', 'graded_by', 'grade_source', 'grade_version', 'id', 'is_correct', 'points_awarded', 'ai_status', 'ai_source', 'ai_verdict', 'ai_confidence', 'ai_rationale', 'ai_flagged', 'ai_error'].sort(),
    );
    assert.equal((await request(base, 'GET', `/api/grading/${fx.sessionId}/answers?ids=abc`, grader.token)).status, 400);
  });

  test('filter=needs_review: only text questions with ungraded rows, and only those rows', async () => {
    const a = answerRow(kids[0].id, fx.textQuestionId);
    assert.equal(
      (await request(base, 'PUT', `/api/grading/${fx.sessionId}/answers/${a.id}`, grader.token, { is_correct: true, points_awarded: 2, expected_version: a.grade_version })).status,
      200,
    );
    const r = await request(base, 'GET', `/api/grading/${fx.sessionId}/quiz?filter=needs_review`, grader.token);
    assert.equal(r.body.questions.length, 1);
    assert.equal(r.body.questions[0].question.id, fx.textQuestionId);
    assert.equal(r.body.questions[0].answers.length, 5);
    assert.ok(r.body.questions[0].answers.every((x: { points_awarded: number | null }) => x.points_awarded === null));
    assert.deepEqual(r.body.progress, { graded: 1, total: 6 });
  });
});

describe('status rule', () => {
  test('participantStatus', () => {
    assert.equal(participantStatus({ submitted_at: null, answered_count: 0, needs_review_count: 0 }), 'not_started');
    assert.equal(participantStatus({ submitted_at: null, answered_count: 3, needs_review_count: 0 }), 'answering');
    assert.equal(participantStatus({ submitted_at: '2026-10-09T10:00:00.000Z', answered_count: 0, needs_review_count: 0 }), 'graded');
    assert.equal(participantStatus({ submitted_at: '2026-10-09T10:00:00.000Z', answered_count: 3, needs_review_count: 1 }), 'needs_review');
  });

  test('joined and never answered: not_started during the quiz, graded after it ends', async () => {
    const fx = await startedFixture('Status quiz');
    const kid = await participant(fx, 'Late Kid');
    const during = await request(base, 'GET', `/api/grading/${fx.sessionId}/summary`, adminToken);
    assert.equal(during.body.participants.find((p: { id: number }) => p.id === kid.id).status, 'not_started');
    assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/end`, adminToken)).status, 200);
    const afterEnd = await request(base, 'GET', `/api/grading/${fx.sessionId}/summary`, adminToken);
    const p = afterEnd.body.participants.find((x: { id: number }) => x.id === kid.id);
    assert.equal(p.status, 'graded');
    assert.equal(p.submit_source, 'session_end');
  });
});

describe('migrations and answer keys', () => {
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
    const tables = (mem.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name").all() as { name: string; sql: string }[]);
    const rows = Object.fromEntries(
      tables.filter((t) => t.sql?.startsWith('CREATE TABLE')).map((t) => [t.name, mem.prepare(`SELECT * FROM ${t.name}`).all()]),
    );
    return { tables, rows };
  }

  test('the answer-key backfill fills 30 / 10 / 10 once, then nothing; it never overwrites', () => {
    const mem = freshDb();
    const insertQuiz = mem.prepare('INSERT INTO quizzes (title, time_limit_seconds, created_by) VALUES (?, 60, 1)');
    const insertQuestion = mem.prepare("INSERT INTO questions (quiz_id, sort_order, type, text, points) VALUES (?, ?, 'text', ?, 1)");
    for (const key of [CHIDON_5786_KEY, CHIDON_5787_ANFAENGER_KEY, CHIDON_5787_FORTGESCHRITTENE_KEY]) {
      const quizId = Number(insertQuiz.run('Key quiz').lastInsertRowid);
      key.forEach((e, i) => insertQuestion.run(quizId, i, e.text));
    }
    // An author's own answer and a choice question with a matching text stay untouched.
    mem.prepare('UPDATE questions SET reference_answer = ? WHERE text = ?').run('my own', CHIDON_5786_KEY[1].text);
    mem.prepare("INSERT INTO questions (quiz_id, sort_order, type, text, points) VALUES (1, 99, 'single', ?, 1)").run(CHIDON_5786_KEY[0].text);

    assert.deepEqual(backfillAnswerKeys(mem), [29, 10, 10]);
    assert.deepEqual(backfillAnswerKeys(mem), [0, 0, 0]);
    const kayin = mem.prepare("SELECT reference_answer, accepted_answers, grader_notes FROM questions WHERE text = ? AND type = 'text'").get(CHIDON_5786_KEY[0].text);
    assert.deepEqual(kayin, { reference_answer: 'Farmer / worker of the soil', accepted_answers: '["Farmer","worker of the soil"]', grader_notes: null });
    assert.equal((mem.prepare('SELECT reference_answer FROM questions WHERE text = ?').get(CHIDON_5786_KEY[1].text) as { reference_answer: string }).reference_answer, 'my own');
    assert.equal(mem.prepare("SELECT COUNT(*) AS n FROM questions WHERE type = 'single' AND reference_answer IS NOT NULL").pluck().get(), 0);
    const kain = mem.prepare('SELECT reference_answer, grader_notes FROM questions WHERE text = ?').get(CHIDON_5787_ANFAENGER_KEY[1].text);
    assert.deepEqual(kain, { reference_answer: 'Kain', grader_notes: 'Bereschit 4,8' });
  });

  test('each key has 30 / 10 / 10 entries with unique texts', () => {
    assert.equal(CHIDON_5786_KEY.length, 30);
    assert.equal(CHIDON_5787_ANFAENGER_KEY.length, 10);
    assert.equal(CHIDON_5787_FORTGESCHRITTENE_KEY.length, 10);
    for (const key of [CHIDON_5786_KEY, CHIDON_5787_ANFAENGER_KEY, CHIDON_5787_FORTGESCHRITTENE_KEY]) {
      assert.equal(new Set(key.map((e) => e.text)).size, key.length);
      for (const e of key) {
        // S12 stored the model answer split on ' / '; S13 only appends to that list.
        assert.deepEqual(e.s12.accepted, e.reference.split(' / '));
        assert.deepEqual(e.accepted.slice(0, e.s12.accepted.length), e.s12.accepted);
      }
    }
  });

  test('running the migrations a second time changes nothing (schema and rows)', () => {
    const mem = freshDb();
    const quizId = Number(mem.prepare('INSERT INTO quizzes (title, time_limit_seconds, created_by) VALUES (?, 60, 1)').run('Q').lastInsertRowid);
    mem.prepare("INSERT INTO questions (quiz_id, sort_order, type, text, points) VALUES (?, 0, 'text', ?, 1)").run(quizId, CHIDON_5786_KEY[2].text);
    runMigrations(mem);
    const once = dump(mem);
    runMigrations(mem);
    assert.deepEqual(dump(mem), once);
    const cols = (t: string) => (mem.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    assert.ok(['reference_answer', 'accepted_answers', 'grader_notes'].every((c) => cols('questions').includes(c)));
    assert.ok(cols('quizzes').includes('default_points'));
    assert.ok(cols('grader_links').includes('code_hash') && cols('grade_events').includes('old_points'));
  });
});
