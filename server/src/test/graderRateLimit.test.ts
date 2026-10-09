import './env';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdmin, createQuizFixture, login, request, startServer } from './helpers';

// Its own file (own process): the limiter counts per client IP for the whole process.

let base = '';
let close: () => Promise<void>;
let code = '';

before(async () => {
  ({ base, close } = await startServer());
  const adminId = createAdmin();
  const adminToken = await login(base);
  const fx = createQuizFixture(adminId, 'Rate limit quiz');
  const r = await request(base, 'POST', `/api/sessions/${fx.sessionId}/grader-links`, adminToken, {});
  assert.equal(r.status, 201);
  code = r.body.code;
});

after(async () => {
  await close();
});

async function exchange(c: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api/grader/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ code: c, name: 'Grader' }),
  });
  return { status: res.status, headers: res.headers, body: await res.json() };
}

test('30 successful exchanges are not limited', async () => {
  for (let i = 0; i < 30; i++) assert.equal((await exchange(code)).status, 200, `exchange ${i + 1}`);
});

test('20 wrong codes in 15 minutes are answered, the 21st is 429; a forged X-Forwarded-For does not reset it', async () => {
  for (let i = 0; i < 20; i++) {
    const r = await exchange('WRNG-WRNG-WRNG-WRNG');
    assert.equal(r.status, 401, `attempt ${i + 1}`);
    assert.match(r.headers.get('ratelimit-policy') ?? '', /q=20;w=900/);
  }
  const limited = await exchange('WRNG-WRNG-WRNG-WRNG');
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'RATE_LIMITED');
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(limited.headers.get('x-ratelimit-limit'), null, 'no legacy headers');
  // With TRUST_PROXY_HOPS=0 the client cannot pick another counter.
  assert.equal((await exchange('WRNG-WRNG-WRNG-WRNG', { 'X-Forwarded-For': '203.0.113.9' })).status, 429);
});

test('a valid code still passes after 20 wrong ones from the same address (shared proxy or NAT)', async () => {
  const ok = await exchange(code, { 'X-Forwarded-For': '198.51.100.7' });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  // ... while wrong codes stay refused.
  assert.equal((await exchange('WRNG-WRNG-WRNG-WRNG')).status, 429);
});
