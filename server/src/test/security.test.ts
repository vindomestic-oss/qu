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
import { sectionsRouter } from '../routes/sections';
import { gradingRouter } from '../routes/grading';
import { nowIso } from '../lib/time';
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
  'PUT /api/quizzes/:id/languages',
  'DELETE /api/quizzes/:id',
  'POST /api/quizzes/:id/questions',
  'PUT /api/quizzes/:id/questions/reorder',
  'POST /api/quizzes/:id/sections',
  'PUT /api/quizzes/:id/sections/reorder',
  'PUT /api/sections/:id',
  'DELETE /api/sections/:id',
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
  'PUT /api/sessions/:id/participants/:participantId/allow-rejoin',
  'PUT /api/sessions/:id/joining',
  'POST /api/sessions/:id/grader-links',
  'GET /api/sessions/:id/grader-links',
  'DELETE /api/sessions/:id/grader-links/:linkId',
  'GET /api/admin/backups',
  'GET /api/admin/backups/latest',
].sort();

/**
 * Every grading-panel route (wish 8). Admins and the grader of THIS session only; checked against
 * every other token kind below, like the admin routes.
 */
const EXPECTED_GRADING_ROUTES = [
  'GET /api/grading/:sessionId/summary',
  'GET /api/grading/:sessionId/participants/:participantId',
  'GET /api/grading/:sessionId/quiz',
  'GET /api/grading/:sessionId/answers',
  'PUT /api/grading/:sessionId/answers/:answerId',
  'POST /api/grading/:sessionId/answers/bulk-grade',
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
  let sectionId: number;

  before(async () => {
    fx = createQuizFixture(adminId, 'Coverage quiz');
    sectionId = Number(
      db
        .prepare("INSERT INTO quiz_sections (quiz_id, name, sort_order, created_at) VALUES (?, 'Coverage rubric', 0, ?)")
        .run(fx.quizId, new Date().toISOString()).lastInsertRowid,
    );
    db.prepare('UPDATE questions SET section_id = ? WHERE id = ?').run(sectionId, fx.textQuestionId);
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
      ...collectRoutes(sectionsRouter, '/api/sections'),
      'GET /api/auth/me',
    ].sort();
    assert.deepEqual(actual, EXPECTED_ADMIN_ROUTES);
  });

  test('every admin route rejects missing, foreign and forged tokens without side effects', async () => {
    const idFor: Record<string, number> = {
      '/api/quizzes': fx.quizId,
      '/api/questions': fx.textQuestionId,
      '/api/sessions': fx.sessionId,
      '/api/sections': sectionId,
      '/api/admin': 0,
      '/api/auth': 0,
    };
    const snapshot = () => ({
      counts: tableCounts(),
      session: db.prepare('SELECT status, joining_locked FROM sessions WHERE id = ?').get(fx.sessionId),
      rejoinHash: (db.prepare('SELECT rejoin_hash FROM participants WHERE id = ?').get(participantId) as { rejoin_hash: string | null })
        .rejoin_hash,
      points: (db.prepare('SELECT points_awarded FROM answers WHERE id = ?').get(answerId) as { points_awarded: number | null })
        .points_awarded,
      sections: db.prepare('SELECT id, name, sort_order FROM quiz_sections WHERE quiz_id = ? ORDER BY id').all(fx.quizId),
      sectionIds: db.prepare('SELECT id, section_id FROM questions WHERE quiz_id = ? ORDER BY id').all(fx.quizId),
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
        .replace(':linkId', '1')
        .replace(':id', String(idFor[mount]));
      for (const v of variants) {
        const body =
          method === 'GET' || method === 'DELETE'
            ? undefined
            : { points_awarded: 0, title: 'x', locked: true, name: 'x', orderedIds: [sectionId] };
        const r = await request(base, method, path, v.token, body);
        assert.equal(r.status, v.status, `${route} with ${v.name}: expected ${v.status}, got ${r.status}`);
        assert.equal(r.body?.code, v.code, `${route} with ${v.name}: code`);
      }
    }

    assert.deepEqual(snapshot(), beforeState);
  });

  test('the grading table lists every grading route', () => {
    assert.deepEqual(collectRoutes(gradingRouter, '/api/grading/:sessionId').sort(), EXPECTED_GRADING_ROUTES);
  });

  test('every grading route rejects missing, foreign, forged and revoked tokens without side effects', async () => {
    const other = createQuizFixture(adminId, 'Coverage quiz B');
    const linkFor = (sessionId: number) =>
      Number(
        db
          .prepare('INSERT INTO grader_links (session_id, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?)')
          .run(sessionId, `hash-${sessionId}-${Math.random()}`, new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 3_600_000).toISOString())
          .lastInsertRowid,
      );
    const otherLink = linkFor(other.sessionId);
    const revokedLink = linkFor(fx.sessionId);
    db.prepare('UPDATE grader_links SET revoked_at = ? WHERE id = ?').run(nowIso(), revokedLink);
    const snapshot = () => ({
      counts: tableCounts(),
      answer: db.prepare('SELECT points_awarded, grade_version FROM answers WHERE id = ?').get(answerId),
      events: (db.prepare('SELECT COUNT(*) AS n FROM grade_events').get() as { n: number }).n,
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
      {
        name: 'grader token of another session',
        token: sign({ role: 'grader', sessionId: other.sessionId, linkId: otherLink, graderName: 'G' }),
        status: 403,
        code: 'FORBIDDEN',
      },
      {
        name: 'grader token of a revoked link',
        token: sign({ role: 'grader', sessionId: fx.sessionId, linkId: revokedLink, graderName: 'G' }),
        status: 401,
        code: 'INVALID_TOKEN',
      },
      {
        name: 'grader token of a link that does not exist',
        token: sign({ role: 'grader', sessionId: fx.sessionId, linkId: 999_999, graderName: 'G' }),
        status: 401,
        code: 'INVALID_TOKEN',
      },
      {
        name: 'token signed with another secret',
        token: sign({ role: 'admin', adminId, username: 'admin' }, 'another-secret'),
        status: 401,
        code: 'INVALID_TOKEN',
      },
      { name: 'unsigned token', token: unsignedToken({ role: 'admin', adminId, username: 'admin' }), status: 401, code: 'INVALID_TOKEN' },
    ];
    for (const route of EXPECTED_GRADING_ROUTES) {
      const [method, pattern] = route.split(' ');
      const path = pattern
        .replace(':sessionId', String(fx.sessionId))
        .replace(':participantId', String(participantId))
        .replace(':answerId', String(answerId));
      for (const v of variants) {
        const body =
          method === 'GET'
            ? undefined
            : { is_correct: true, points_awarded: 1, expected_version: 0, items: [{ answer_id: answerId, expected_version: 0 }] };
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
    // Graders' fields filled in, so a leak would show (wish 8).
    db.prepare(`UPDATE questions SET reference_answer = 'secret', accepted_answers = '["secret"]', grader_notes = 'note' WHERE id = ?`).run(
      fx.textQuestionId,
    );
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

  test('ended session: results include correctness, never the graders\' fields', async () => {
    assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/end`, adminToken)).status, 200);
    const r = await request(base, 'GET', '/api/my/results', token);
    assert.equal(r.status, 200);
    assert.ok(findKeys(r.body, ['is_correct']).length > 0);
    assert.deepEqual(findKeys(r.body, ['reference_answer', 'accepted_answers', 'grader_notes', 'graded_by', 'grade_version']), []);
  });
});
