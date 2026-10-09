import './env';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdmin, createQuizFixture, join, login, request, startServer, type QuizFixture } from './helpers';

// S15 join limiter (wish 5). Its own file (own process): the limiter counts per client address for
// the whole process. Two servers: one trusting one proxy hop (limiter on; the client address is the
// right-most X-Forwarded-For entry, as Render's proxy would append it) and one with the default 0.

const SCHOOL = '203.0.113.10';
const OTHER_SCHOOL = '198.51.100.20';

let onBase = '';
let offBase = '';
const closers: (() => Promise<void>)[] = [];
let adminToken = '';
let fx: QuizFixture;
let ended: QuizFixture;

before(async () => {
  process.env.TRUST_PROXY_HOPS = '1';
  const on = await startServer();
  delete process.env.TRUST_PROXY_HOPS;
  const off = await startServer();
  onBase = on.base;
  offBase = off.base;
  closers.push(on.close, off.close);
  const adminId = createAdmin();
  adminToken = await login(onBase);
  fx = createQuizFixture(adminId, 'Limiter quiz');
  ended = createQuizFixture(adminId, 'Limiter ended quiz');
  assert.equal((await request(onBase, 'PUT', `/api/sessions/${ended.sessionId}/end`, adminToken)).status, 200);
});

after(async () => {
  for (const close of closers) await close();
});

async function joinFrom(base: string, xff: string | null, joinCode: string, displayName: string) {
  const res = await fetch(`${base}/api/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(xff ? { 'X-Forwarded-For': xff } : {}) },
    body: JSON.stringify({ joinCode, displayName }),
  });
  return { status: res.status, headers: res.headers, body: (await res.json()) as Record<string, unknown> };
}

describe('TRUST_PROXY_HOPS=1: the limiter is on', () => {
  test('a whole class from one address: 60 joins, 60 "session ended", rejoins and taken names are never limited', async () => {
    for (let i = 0; i < 60; i++) assert.equal((await joinFrom(onBase, SCHOOL, fx.joinCode, `Kid ${i}`)).status, 200, `join ${i + 1}`);
    for (let i = 0; i < 60; i++) {
      const r = await joinFrom(onBase, SCHOOL, ended.joinCode, `Late ${i}`);
      assert.equal(r.status, 400, `ended ${i + 1}`);
      assert.equal(r.body.code, 'SESSION_ENDED');
    }
    for (let i = 0; i < 20; i++) assert.equal((await joinFrom(onBase, SCHOOL, fx.joinCode, 'Kid 1')).status, 409, 'NAME_TAKEN');
    const r = await joinFrom(onBase, SCHOOL, fx.joinCode, 'Kid 60');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('ratelimit-policy') ?? '', /q=100;w=600/);
    assert.match(r.headers.get('ratelimit') ?? '', /r=100;/, 'nothing counted yet');
  });

  test('100 unknown codes are answered (404), the 101st is 429; then every join from that address waits', async () => {
    for (let i = 0; i < 100; i++) {
      const r = await joinFrom(onBase, SCHOOL, 'ZZZZZ2', 'Guesser');
      assert.equal(r.status, 404, `attempt ${i + 1}`);
      assert.equal(r.body.code, 'INVALID_CODE');
    }
    const limited = await joinFrom(onBase, SCHOOL, 'ZZZZZ2', 'Guesser');
    assert.equal(limited.status, 429);
    assert.deepEqual(limited.body, { error: 'Too many attempts', code: 'RATE_LIMITED' });
    assert.ok(Number(limited.headers.get('retry-after')) > 0, 'Retry-After');
    assert.match(limited.headers.get('ratelimit') ?? '', /r=0;/);
    assert.equal(limited.headers.get('x-ratelimit-limit'), null, 'no legacy headers');
    // A valid code from the blocked address waits too: the answer must not reveal which codes exist.
    assert.equal((await joinFrom(onBase, SCHOOL, fx.joinCode, 'Kid 61')).status, 429);
  });

  test('a forged left-most X-Forwarded-For entry does not pick a fresh counter', async () => {
    assert.equal((await joinFrom(onBase, `192.0.2.99, ${SCHOOL}`, 'ZZZZZ2', 'Guesser')).status, 429);
  });

  test('another address is not affected', async () => {
    assert.equal((await joinFrom(onBase, OTHER_SCHOOL, fx.joinCode, 'Other school kid')).status, 200);
    assert.equal((await joinFrom(onBase, OTHER_SCHOOL, 'ZZZZZ2', 'Other school kid')).status, 404);
  });

  test('/api/debug/ip (admin only) shows the address Express sees and the raw X-Forwarded-For', async () => {
    const res = await fetch(`${onBase}/api/debug/ip`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Forwarded-For': `192.0.2.1, ${OTHER_SCHOOL}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { ip: OTHER_SCHOOL, xff: `192.0.2.1, ${OTHER_SCHOOL}` });
    assert.equal((await request(onBase, 'GET', '/api/debug/ip')).status, 401);
    const kid = await join(onBase, fx.joinCode, 'Debug Kid');
    assert.equal((await request(onBase, 'GET', '/api/debug/ip', kid.body.token)).status, 403);
  });
});

describe('TRUST_PROXY_HOPS unset (0): the limiter is off', () => {
  test('150 unknown codes from one address are all answered, without rate-limit headers', async () => {
    for (let i = 0; i < 150; i++) {
      const r = await joinFrom(offBase, null, 'YYYYY3', 'Typo');
      assert.equal(r.status, 404, `attempt ${i + 1}`);
      assert.equal(r.headers.get('ratelimit-policy'), null);
    }
    assert.equal((await joinFrom(offBase, null, fx.joinCode, 'Still welcome')).status, 200);
  });

  test('/api/debug/ip shows the socket address and ignores X-Forwarded-For', async () => {
    const res = await fetch(`${offBase}/api/debug/ip`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'X-Forwarded-For': SCHOOL },
    });
    const body = (await res.json()) as { ip: string; xff: string | null };
    assert.match(body.ip, /127\.0\.0\.1$/);
    assert.equal(body.xff, SCHOOL);
  });
});
