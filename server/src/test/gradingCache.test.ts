import './env';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db';
import {
  cachedForSession,
  clearGradingCache,
  gradingCacheStats,
  GRADING_CACHE_MAX_ENTRIES,
  GRADING_CACHE_TTL_MS,
} from '../lib/gradingCache';
import { io as connect } from 'socket.io-client';
import { createAdmin, createQuizFixture, findKeys, join, login, request, startServer, type QuizFixture } from './helpers';

// The grading panel's shared, per-session cache (lib/gradingCache.ts): one computation of the
// session-wide summary / whole-quiz data serves every viewer for about a second, every grading write
// invalidates it at once, and nothing crosses sessions or viewers.

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

beforeEach(() => clearGradingCache());

async function startedFixture(title: string): Promise<QuizFixture> {
  const fx = createQuizFixture(adminId, title);
  assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, adminToken)).status, 200);
  return fx;
}

async function graderToken(sessionId: number, name = 'Rav K.'): Promise<string> {
  const link = await request(base, 'POST', `/api/sessions/${sessionId}/grader-links`, adminToken, { label: name });
  const ex = await request(base, 'POST', '/api/grader/exchange', undefined, { code: link.body.code, name });
  assert.equal(ex.status, 200);
  return ex.body.token;
}

async function kid(fx: QuizFixture, name: string, opts: { text?: string; submit?: boolean } = {}) {
  const joined = await join(base, fx.joinCode, name);
  const token = joined.body.token as string;
  if (opts.text !== undefined) {
    assert.equal((await request(base, 'POST', `/api/my/answers/${fx.textQuestionId}`, token, { text_answer: opts.text })).status, 200);
  }
  if (opts.submit) assert.equal((await request(base, 'POST', '/api/my/submit', token)).status, 200);
  return { token, id: joined.body.participant.id as number };
}

const summary = (sessionId: number, token = adminToken) => request(base, 'GET', `/api/grading/${sessionId}/summary`, token);
const textAnswer = (participantId: number, questionId: number) =>
  db.prepare('SELECT id, grade_version FROM answers WHERE participant_id = ? AND question_id = ?').get(participantId, questionId) as {
    id: number;
    grade_version: number;
  };

describe('sharing', () => {
  test('viewers of a session share one computation; viewer fields stay per request; names as before', async () => {
    const fx = await startedFixture('Cache share quiz');
    await kid(fx, 'Ada', { text: 'gravity', submit: true });
    const grader = await graderToken(fx.sessionId);

    const asAdmin = await summary(fx.sessionId);
    const before = gradingCacheStats();
    const asGrader = await summary(fx.sessionId, grader);
    const afterStats = gradingCacheStats();
    assert.equal(afterStats.hits, before.hits + 1, 'the second viewer is served from the cache');
    assert.equal(afterStats.misses, before.misses);
    assert.deepEqual(asAdmin.body.viewer, { kind: 'admin', name: 'admin' });
    assert.deepEqual(asGrader.body.viewer, { kind: 'grader', name: 'Rav K.' });
    // Q-names: both see the participant list with names; the rest is the same data.
    assert.equal(asGrader.body.participants[0].display_name, 'Ada');
    const { viewer: _a, ...sharedAdmin } = asAdmin.body;
    const { viewer: _g, ...sharedGrader } = asGrader.body;
    assert.deepEqual(sharedGrader, sharedAdmin);

    // Whole quiz: shared too, and still anonymous for every viewer.
    const q1 = await request(base, 'GET', `/api/grading/${fx.sessionId}/quiz?filter=all`, grader);
    const q2 = await request(base, 'GET', `/api/grading/${fx.sessionId}/quiz?filter=all`, adminToken);
    assert.equal(q2.body.viewer.kind, 'admin');
    assert.equal(q1.body.viewer.kind, 'grader');
    for (const body of [q1.body, q2.body]) assert.deepEqual(findKeys(body, ['display_name', 'participant_id']), []);
    // The two filters are separate entries.
    const nr = await request(base, 'GET', `/api/grading/${fx.sessionId}/quiz?filter=needs_review`, grader);
    assert.equal(nr.body.filter, 'needs_review');
    assert.equal(q1.body.filter, 'all');
  });

  test('a change that sends no event (a question text) shows up after the TTL at the latest', async () => {
    const fx = await startedFixture('Cache TTL quiz');
    const first = await summary(fx.sessionId);
    const q = first.body.questions.find((x: { id: number }) => x.id === fx.textQuestionId);
    db.prepare('UPDATE questions SET text = ? WHERE id = ?').run('Edited text', fx.textQuestionId);
    const within = (await summary(fx.sessionId)).body.questions.find((x: { id: number }) => x.id === fx.textQuestionId);
    assert.equal(within.text, q.text, 'within the TTL the shared copy is used');
    await new Promise((r) => setTimeout(r, GRADING_CACHE_TTL_MS + 50));
    const later = (await summary(fx.sessionId)).body.questions.find((x: { id: number }) => x.id === fx.textQuestionId);
    assert.equal(later.text, 'Edited text');
  });

  test('an answer save or a join (session:live) invalidates too, so refetches on that event are fresh', async () => {
    const fx = await startedFixture('Cache live quiz');
    const staff = connect(base, { transports: ['websocket'], forceNew: true, reconnection: false });
    try {
      await new Promise<void>((resolve) => staff.once('connect', () => resolve()));
      assert.equal((await staff.timeout(2000).emitWithAck('staff:join', { sessionId: fx.sessionId, token: adminToken })).ok, true);
      const nextLive = () =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('no session:live within 2 s')), 2000);
          staff.once('session:live', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      // Each time: another viewer reads (caching the state before the change), the change happens,
      // and the dashboard refetches on the session:live that follows: it must see the change.
      await new Promise((r) => setTimeout(r, 600)); // no coalescing window left from the start
      assert.equal((await summary(fx.sessionId)).body.counters.participants_joined, 0);
      let live = nextLive();
      const ada = await kid(fx, 'Ada');
      await live;
      assert.equal((await summary(fx.sessionId)).body.counters.participants_joined, 1, 'the join');

      // The save falls into the 500 ms window the join opened: its trailing session:live invalidates.
      assert.equal((await summary(fx.sessionId)).body.counters.answers_given, 0);
      live = nextLive();
      await request(base, 'POST', `/api/my/answers/${fx.textQuestionId}`, ada.token, { text_answer: 'typing' });
      await live;
      assert.equal((await summary(fx.sessionId)).body.counters.answers_given, 1, 'the save');

      // The whole-quiz list is not refetched on session:live and shows submitted answers only: its
      // entry stays shared across a live event (only the summary is dropped).
      await request(base, 'GET', `/api/grading/${fx.sessionId}/quiz?filter=all`, adminToken);
      live = nextLive();
      await request(base, 'POST', `/api/my/answers/${fx.textQuestionId}`, ada.token, { text_answer: 'typing more' });
      await live;
      const hits = gradingCacheStats().hits;
      await request(base, 'GET', `/api/grading/${fx.sessionId}/quiz?filter=all`, adminToken);
      assert.equal(gradingCacheStats().hits, hits + 1, 'the whole-quiz entry survived the live event');
    } finally {
      staff.disconnect();
    }
  });

  test('expired entries are swept on every insert', async () => {
    clearGradingCache();
    cachedForSession(200_001, 'summary', () => 1);
    cachedForSession(200_002, 'summary', () => 2);
    assert.equal(gradingCacheStats().size, 2);
    await new Promise((r) => setTimeout(r, GRADING_CACHE_TTL_MS + 20));
    cachedForSession(200_003, 'summary', () => 3);
    assert.equal(gradingCacheStats().size, 1, 'the two expired entries are gone');
  });

  test('no data crosses sessions', async () => {
    const a = await startedFixture('Cache session A');
    const b = await startedFixture('Cache session B');
    await kid(a, 'Only in A', { text: 'a', submit: true });
    await kid(b, 'Only in B', { text: 'b', submit: true });
    const ra = await summary(a.sessionId);
    const rb = await summary(b.sessionId);
    assert.equal(ra.body.session.id, a.sessionId);
    assert.equal(rb.body.session.id, b.sessionId);
    assert.deepEqual(ra.body.participants.map((p: { display_name: string }) => p.display_name), ['Only in A']);
    assert.deepEqual(rb.body.participants.map((p: { display_name: string }) => p.display_name), ['Only in B']);
    // A grader of A still cannot read B (the cache sits behind the access check).
    const graderA = await graderToken(a.sessionId);
    assert.equal((await summary(b.sessionId, graderA)).status, 403);
    const qa = await request(base, 'GET', `/api/grading/${a.sessionId}/quiz?filter=all`, adminToken);
    const qb = await request(base, 'GET', `/api/grading/${b.sessionId}/quiz?filter=all`, adminToken);
    const texts = (body: { questions: { answers: { text_answer?: string }[] }[] }) =>
      body.questions.flatMap((q) => q.answers.map((x) => x.text_answer)).filter(Boolean);
    assert.deepEqual(texts(qa.body), ['a']);
    assert.deepEqual(texts(qb.body), ['b']);
  });

  test('the cache is bounded', () => {
    clearGradingCache();
    for (let i = 0; i < GRADING_CACHE_MAX_ENTRIES + 20; i++) cachedForSession(100_000 + i, 'summary', () => ({ i }));
    assert.equal(gradingCacheStats().size, GRADING_CACHE_MAX_ENTRIES);
    // The newest entries stay.
    assert.deepEqual(
      cachedForSession(100_000 + GRADING_CACHE_MAX_ENTRIES + 19, 'summary', () => ({ i: -1 })),
      { i: GRADING_CACHE_MAX_ENTRIES + 19 },
    );
  });
});

describe('every grading write invalidates the session at once', () => {
  let fx: QuizFixture;
  let grader: string;
  let ada: { token: string; id: number };
  let ben: { token: string; id: number };

  before(async () => {
    fx = await startedFixture('Cache invalidation quiz');
    ada = await kid(fx, 'Ada', { text: 'mass attracts mass', submit: true });
    ben = await kid(fx, 'Ben', { text: 'something else' });
    grader = await graderToken(fx.sessionId);
  });

  /** Primes the cache, runs the write, and returns the summary read right after it (a cache miss). */
  async function afterWrite(write: () => Promise<unknown>) {
    await summary(fx.sessionId, grader);
    await request(base, 'GET', `/api/grading/${fx.sessionId}/quiz?filter=needs_review`, grader);
    await write();
    const misses = gradingCacheStats().misses;
    const s = await summary(fx.sessionId, grader);
    const q = await request(base, 'GET', `/api/grading/${fx.sessionId}/quiz?filter=needs_review`, grader);
    assert.equal(gradingCacheStats().misses, misses + 2, 'both reads after the write are computed fresh');
    return { s: s.body, q: q.body };
  }

  test('a grade (PUT)', async () => {
    const a = textAnswer(ada.id, fx.textQuestionId);
    const { s, q } = await afterWrite(() =>
      request(base, 'PUT', `/api/grading/${fx.sessionId}/answers/${a.id}`, grader, { is_correct: true, points_awarded: 2, expected_version: a.grade_version }),
    );
    assert.equal(s.counters.needs_review, 0);
    assert.equal(s.counters.correct, 1);
    assert.equal(q.questions.length, 0, 'nothing left to review');
  });

  test('a submit', async () => {
    const { s } = await afterWrite(() => request(base, 'POST', '/api/my/submit', ben.token));
    assert.equal(s.counters.participants_submitted, 2);
    assert.equal(s.counters.needs_review, 1);
  });

  test('a bulk grade', async () => {
    const b = textAnswer(ben.id, fx.textQuestionId);
    const { s } = await afterWrite(() =>
      request(base, 'POST', `/api/grading/${fx.sessionId}/answers/bulk-grade`, grader, {
        is_correct: false,
        points_awarded: 0,
        items: [{ answer_id: b.id, expected_version: b.grade_version }],
      }),
    );
    assert.equal(s.counters.needs_review, 0);
    assert.equal(s.counters.incorrect, 1);
  });

  test('a reopened submission', async () => {
    const { s } = await afterWrite(() => request(base, 'POST', `/api/sessions/${fx.sessionId}/participants/${ben.id}/reopen`, adminToken));
    assert.equal(s.counters.participants_submitted, 1);
    assert.equal(s.participants.find((p: { id: number }) => p.id === ben.id).submitted_at, null);
  });

  test('a regrade after the points change', async () => {
    const quiz = await request(base, 'GET', `/api/quizzes/${fx.quizId}`, adminToken);
    const q = quiz.body.quiz.questions.find((x: { id: number }) => x.id === fx.textQuestionId);
    const { s } = await afterWrite(() =>
      request(base, 'PUT', `/api/questions/${fx.textQuestionId}`, adminToken, { type: 'text', text: q.text, points: 3 }),
    );
    assert.equal(s.quiz.total_points, 4);
    assert.equal(s.participants.find((p: { id: number }) => p.id === ada.id).score, 3, 'full points follow the new maximum');
  });

  test('an accepted answer (key change, rule grades)', async () => {
    // A new submitted answer that nobody graded, then "accept this answer" adds it to the key.
    const cid = await kid(fx, 'Cid', { text: 'curved spacetime', submit: true });
    const c = textAnswer(cid.id, fx.textQuestionId);
    await summary(fx.sessionId, grader);
    assert.equal((await summary(fx.sessionId, grader)).body.counters.needs_review, 1);
    const { s } = await afterWrite(() => request(base, 'POST', `/api/questions/${fx.textQuestionId}/accepted-answers`, adminToken, { answerId: c.id }));
    assert.equal(s.counters.needs_review, 0, 'the rule credited the answer');
  });

  test('the session end', async () => {
    const { s } = await afterWrite(() => request(base, 'PUT', `/api/sessions/${fx.sessionId}/end`, adminToken));
    assert.equal(s.session.status, 'ended');
    assert.equal(s.counters.participants_submitted, s.counters.participants_joined);
  });
});

describe('session start', () => {
  test('starting a session invalidates its cached status', async () => {
    const fx = createQuizFixture(adminId, 'Cache start quiz');
    const grader = await graderToken(fx.sessionId);
    assert.equal((await summary(fx.sessionId, grader)).body.session.status, 'pending');
    assert.equal((await request(base, 'PUT', `/api/sessions/${fx.sessionId}/start`, adminToken)).status, 200);
    assert.equal((await summary(fx.sessionId, grader)).body.session.status, 'active');
  });
});
