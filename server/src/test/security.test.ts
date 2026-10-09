import './env';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db';
import { quizzesRouter } from '../routes/quizzes';
import { questionsRouter } from '../routes/questions';
import { sessionsRouter } from '../routes/sessions';
import { adminRouter } from '../routes/admin';
import {
  createAdmin,
  createQuizFixture,
  findKeys,
  join,
  login,
  request,
  sign,
  startServer,
  tableCounts,
  unsignedToken,
  type QuizFixture,
} from './helpers';

/**
 * Every admin route. A route added to one of the routers without being added here fails the
 * coverage test, so each new admin route is checked against every token kind on purpose.
 */
const EXPECTED_ADMIN_ROUTES = [
  'GET /api/auth/me',
  'GET /api/quizzes',
  'POST /api/quizzes',
  'GET /api/quizzes/:id',
  'PUT /api/quizzes/:id',
  'DELETE /api/quizzes/:id',
  'POST /api/quizzes/:id/questions',
  'PUT /api/quizzes/:id/questions/reorder',
  'GET /api/quizzes/:id/sessions',
  'POST /api/quizzes/:id/sessions',
  'PUT /api/questions/:id',
  'DELETE /api/questions/:id',
  'POST /api/questions/:id/image',
  'DELETE /api/questions/:id/image',
  'GET /api/sessions/:id',
  'PUT /api/sessions/:id/start',
  'PUT /api/sessions/:id/end',
  'GET /api/sessions/:id/live',
  'GET /api/sessions/:id/results',
  'PUT /api/sessions/:id/answers/:answerId/grade',
  'PUT /api/sessions/:id/participants/:participantId/allow-rejoin',
  'GET /api/admin/backups',
  'GET /api/admin/backups/latest',
].sort();

const FORBIDDEN_KEYS = [
  'is_correct',
  'isCorrect',
  'points_awarded',
  'pointsAwarded',
  'reference_answer',
  'accepted_answers',
  'grader_notes',
  'password_hash',
  'rejoin_hash',
] as const;

function collectRoutes(router: Router, mount: string): string[] {
  const out: string[] = [];
  for (const layer of router.stack as { route?: { path: string; methods: Record<string, boolean> } }[]) {
    if (!layer.route) continue;
    const path = layer.route.path === '/' ? mount : `${mount}${layer.route.path}`;
    for (const method of Object.keys(layer.route.methods)) out.push(`${method.toUpperCase()} ${path}`);
  }
  return out;
}

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

describe('route coverage', () => {
  let fx: QuizFixture;
  let participantToken: string;
  let participantId: number;
  let answerId: number;

  before(async () => {
    fx = createQuizFixture(adminId, 'Coverage quiz');
    const joined = await join(base, fx.joinCode, 'Coverage Kid');
    assert.equal(joined.status, 200);
    participantToken = joined.body.token;
    participantId = joined.body.participant.id;
    answerId = Number(
      db
        .prepare('INSERT INTO answers (session_id, question_id, participant_id, text_answer) VALUES (?, ?, ?, ?)')
        .run(fx.sessionId, fx.textQuestionId, participantId, 'fixture answer').lastInsertRowid,
    );
  });

  test('the expected table lists every admin route', () => {
    const actual = [
      ...collectRoutes(quizzesRouter, '/api/quizzes'),
      ...collectRoutes(questionsRouter, '/api/questions'),
      ...collectRoutes(sessionsRouter, '/api/sessions'),
      ...collectRoutes(adminRouter, '/api/admin'),
      'GET /api/auth/me',
    ].sort();
    assert.deepEqual(actual, EXPECTED_ADMIN_ROUTES);
  });

  test('every admin route rejects missing, foreign and forged tokens without side effects', async () => {
    const idFor: Record<string, number> = {
      '/api/quizzes': fx.quizId,
      '/api/questions': fx.textQuestionId,
      '/api/sessions': fx.sessionId,
      '/api/admin': 0,
      '/api/auth': 0,
    };
    const snapshot = () => ({
      counts: tableCounts(),
      status: (db.prepare('SELECT status FROM sessions WHERE id = ?').get(fx.sessionId) as { status: string }).status,
      rejoinHash: (db.prepare('SELECT rejoin_hash FROM participants WHERE id = ?').get(participantId) as { rejoin_hash: string | null })
        .rejoin_hash,
      points: (db.prepare('SELECT points_awarded FROM answers WHERE id = ?').get(answerId) as { points_awarded: number | null })
        .points_awarded,
    });
    const beforeState = snapshot();

    const variants: { name: string; token?: string; status: number; code: string }[] = [
      { name: 'no token', status: 401, code: 'AUTH_REQUIRED' },
      { name: 'participant token', token: participantToken, status: 403, code: 'FORBIDDEN' },
      {
        name: 'legacy participant token',
        token: sign({ participantId, sessionId: fx.sessionId, displayName: 'Coverage Kid' }),
        status: 403,
        code: 'FORBIDDEN',
      },
      { name: 'grader token', token: sign({ role: 'grader', sessionId: fx.sessionId, linkId: 1 }), status: 403, code: 'FORBIDDEN' },
      {
        name: 'token signed with another secret',
        token: sign({ role: 'admin', adminId, username: 'admin' }, 'another-secret'),
        status: 401,
        code: 'INVALID_TOKEN',
      },
      {
        name: 'unsigned token',
        token: unsignedToken({ role: 'admin', adminId, username: 'admin' }),
        status: 401,
        code: 'INVALID_TOKEN',
      },
    ];

    for (const route of EXPECTED_ADMIN_ROUTES) {
      const [method, pattern] = route.split(' ');
      const mount = Object.keys(idFor).find((m) => pattern.startsWith(m))!;
      const path = pattern
        .replace(':answerId', String(answerId))
        .replace(':participantId', String(participantId))
        .replace(':id', String(idFor[mount]));
      for (const v of variants) {
        const body = method === 'GET' || method === 'DELETE' ? undefined : { points_awarded: 0, title: 'x' };
        const r = await request(base, method, path, v.token, body);
        assert.equal(r.status, v.status, `${route} with ${v.name}: expected ${v.status}, got ${r.status}`);
        assert.equal(r.body?.code, v.code, `${route} with ${v.name}: code`);
      }
    }

    assert.deepEqual(snapshot(), beforeState);
  });
});

describe('admin tokens', () => {
  test('a current admin token works', async () => {
    const r = await request(base, 'GET', '/api/quizzes', adminToken);
    assert.equal(r.status, 200);
  });

  test('/api/auth/me returns exactly {adminId, username}', async () => {
    const r = await request(base, 'GET', '/api/auth/me', adminToken);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { admin: { adminId, username: 'admin' } });
  });

  test('a legacy admin token (no role) still works', async () => {
    const r = await request(base, 'GET', '/api/quizzes', sign({ adminId, username: 'admin' }, undefined, { expiresIn: '1h' }));
    assert.equal(r.status, 200);
  });

  test('a token whose admin row was deleted gets 401', async () => {
    const tempId = createAdmin('temp-admin', 'temp-password');
    const token = await login(base, 'temp-admin', 'temp-password');
    assert.equal((await request(base, 'GET', '/api/quizzes', token)).status, 200);
    db.prepare('DELETE FROM admins WHERE id = ?').run(tempId);
    const r = await request(base, 'GET', '/api/quizzes', token);
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'INVALID_TOKEN');
  });

  test('a token whose username no longer matches the row gets 401', async () => {
    const r = await request(base, 'GET', '/api/quizzes', sign({ role: 'admin', adminId, username: 'someone-else' }));
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'INVALID_TOKEN');
  });

  test('a password change invalidates tokens issued with the old password, whenever they were issued', async () => {
    const tempId = createAdmin('rotating-admin', 'old-password');
    const oldToken = await login(base, 'rotating-admin', 'old-password');
    assert.equal((await request(base, 'GET', '/api/quizzes', oldToken)).status, 200);
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync('new-password', 4), tempId);
    assert.equal((await request(base, 'GET', '/api/quizzes', oldToken)).status, 401);
    const newToken = await login(base, 'rotating-admin', 'new-password');
    assert.equal((await request(base, 'GET', '/api/quizzes', newToken)).status, 200);
    db.prepare('DELETE FROM admins WHERE id = ?').run(tempId);
  });

  test('tokens issued before tokens_valid_after are rejected', async () => {
    const cutoff = new Date(Date.now() + 10_000).toISOString();
    db.prepare('UPDATE admins SET tokens_valid_after = ? WHERE id = ?').run(cutoff, adminId);
    try {
      assert.equal((await request(base, 'GET', '/api/quizzes', adminToken)).status, 401);
      const later = sign({ role: 'admin', adminId, username: 'admin', iat: Math.floor(Date.now() / 1000) + 20 });
      assert.equal((await request(base, 'GET', '/api/quizzes', later)).status, 200);
    } finally {
      db.prepare('UPDATE admins SET tokens_valid_after = NULL WHERE id = ?').run(adminId);
    }
  });

  test('/api/health reveals nothing but ok', async () => {
    const r = await request(base, 'GET', '/api/health');
    assert.deepEqual(r.body, { ok: true });
  });
});

describe('participant scope', () => {
  let fx: QuizFixture;

  before(() => {
    fx = createQuizFixture(adminId, 'Scope quiz');
  });

  test('an admin token on /api/my/session gets 403', async () => {
    const r = await request(base, 'GET', '/api/my/session', adminToken);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'FORBIDDEN');
  });

  test('/api/my/session returns the token’s own session and a normalised participant', async () => {
    const joined = await join(base, fx.joinCode, 'Scope Kid');
    const r = await request(base, 'GET', '/api/my/session', joined.body.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.session.id, fx.sessionId);
    // submitted_at arrived with the Finish button (S5 in the plan) and is part of the contract.
    assert.deepEqual(Object.keys(r.body.participant).sort(), ['displayName', 'participantId', 'sessionId', 'submitted_at']);
    assert.equal(r.body.participant.participantId, joined.body.participant.id);
  });

  test('a participant token whose row was deleted gets 401', async () => {
    const joined = await join(base, fx.joinCode, 'Deleted Kid');
    db.prepare('DELETE FROM participants WHERE id = ?').run(joined.body.participant.id);
    const r = await request(base, 'GET', '/api/my/session', joined.body.token);
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'INVALID_TOKEN');
  });

  test('a participant token older than its row (database wiped and ids reused) gets 401', async () => {
    const joined = await join(base, fx.joinCode, 'Reused Kid');
    const stale = sign({
      role: 'participant',
      participantId: joined.body.participant.id,
      sessionId: fx.sessionId,
      displayName: 'Reused Kid',
      iat: Math.floor(Date.now() / 1000) - 3600,
    });
    assert.equal((await request(base, 'GET', '/api/my/session', stale)).status, 401);
    assert.equal((await request(base, 'GET', '/api/my/session', joined.body.token)).status, 200);
  });

  test('a participant token with a changed display name gets 401', async () => {
    const joined = await join(base, fx.joinCode, 'Renamed Kid');
    const forged = sign({
      role: 'participant',
      participantId: joined.body.participant.id,
      sessionId: fx.sessionId,
      displayName: 'Someone Else',
    });
    assert.equal((await request(base, 'GET', '/api/my/session', forged)).status, 401);
  });
});

describe('no correctness before release', () => {
  let fx: QuizFixture;
  let token: string;

  before(() => {
    fx = createQuizFixture(adminId, 'Release quiz');
  });

  test('pending session: join and /my/session carry no forbidden keys', async () => {
    const joined = await join(base, fx.joinCode, 'Release Kid');
    assert.equal(joined.status, 200);
    assert.deepEqual(findKeys(joined.body, FORBIDDEN_KEYS), []);
    token = joined.body.token;
    const r = await request(base, 'GET', '/api/my/session', token);
    assert.deepEqual(findKeys(r.body, FORBIDDEN_KEYS), []);
  });

  test('active session: quiz and saves reveal nothing, results are closed', async () => {
    assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, adminToken)).status, 200);

    const quiz = await request(base, 'GET', '/api/my/quiz', token);
    assert.equal(quiz.status, 200);
    assert.deepEqual(findKeys(quiz.body, FORBIDDEN_KEYS), []);

    const choice = await request(base, 'POST', `/api/my/answers/${fx.singleQuestionId}`, token, {
      selected_choice_ids: [fx.correctChoiceId],
    });
    assert.equal(choice.status, 200);
    assert.deepEqual(choice.body, { ok: true });

    const text = await request(base, 'POST', `/api/my/answers/${fx.textQuestionId}`, token, { text_answer: 'Mass attracts mass' });
    assert.equal(text.status, 200);
    assert.deepEqual(text.body, { ok: true });

    assert.equal((await request(base, 'GET', '/api/my/results', token)).status, 400);
  });

  test('ended session: results include correctness', async () => {
    assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/end`, adminToken)).status, 200);
    const r = await request(base, 'GET', '/api/my/results', token);
    assert.equal(r.status, 200);
    assert.ok(findKeys(r.body, ['is_correct']).length > 0);
  });
});
