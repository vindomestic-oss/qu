import './env';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { db } from '../db';
import { createAdmin, createQuizFixture, findKeys, join, login, request, startServer, type QuizFixture } from './helpers';

let base = '';
let close: () => Promise<void>;
let adminToken: string;
let fx: QuizFixture;

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const storedHash = (id: number) =>
  (db.prepare('SELECT rejoin_hash FROM participants WHERE id = ?').get(id) as { rejoin_hash: string | null }).rejoin_hash;

function joinWith(name: string, rejoinSecret?: string) {
  return request(base, 'POST', '/api/join', undefined, { joinCode: fx.joinCode, displayName: name, rejoinSecret });
}

before(async () => {
  ({ base, close } = await startServer());
  createAdmin();
  adminToken = await login(base);
  fx = createQuizFixture(1, 'Rejoin quiz');
});

after(async () => {
  await close();
});

test('a new name gets a rejoin secret whose sha256 is stored', async () => {
  const r = await join(base, fx.joinCode, 'Anna');
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.rejoinSecret, 'string');
  assert.ok(r.body.rejoinSecret.length >= 40);
  assert.equal(storedHash(r.body.participant.id), sha256(r.body.rejoinSecret));
  assert.deepEqual(Object.keys(r.body.participant).sort(), ['display_name', 'id', 'joined_at', 'session_id']);
  assert.deepEqual(findKeys(r.body, ['rejoin_hash']), []);
});

test('the same name without the secret gets 409 NAME_TAKEN; with it, the same participant', async () => {
  const first = await join(base, fx.joinCode, 'Ben');
  const taken = await joinWith('Ben');
  assert.equal(taken.status, 409);
  assert.equal(taken.body.code, 'NAME_TAKEN');
  const wrong = await joinWith('Ben', 'not-the-secret');
  assert.equal(wrong.status, 409);
  const again = await joinWith('Ben', first.body.rejoinSecret);
  assert.equal(again.status, 200);
  assert.equal(again.body.participant.id, first.body.participant.id);
  assert.equal(again.body.rejoinSecret, first.body.rejoinSecret);
});

test('a legacy row (rejoin_hash NULL) can be claimed once, and the hash is then set', async () => {
  const id = Number(
    db.prepare('INSERT INTO participants (session_id, display_name) VALUES (?, ?)').run(fx.sessionId, 'Legacy').lastInsertRowid,
  );
  const r = await joinWith('Legacy');
  assert.equal(r.status, 200);
  assert.equal(r.body.participant.id, id);
  assert.equal(storedHash(id), sha256(r.body.rejoinSecret));
  assert.equal((await joinWith('Legacy')).status, 409);
});

test('after "Allow rejoin" the name can be claimed without the secret', async () => {
  const first = await join(base, fx.joinCode, 'Chen');
  const allow = await request(
    base,
    'PUT',
    `/api/sessions/${fx.sessionId}/participants/${first.body.participant.id}/allow-rejoin`,
    adminToken,
  );
  assert.equal(allow.status, 200);
  assert.deepEqual(allow.body, { ok: true });
  const r = await joinWith('Chen');
  assert.equal(r.status, 200);
  assert.equal(r.body.participant.id, first.body.participant.id);
  assert.notEqual(r.body.rejoinSecret, first.body.rejoinSecret);
});

test('allow-rejoin for a participant of another session is 404', async () => {
  const other = createQuizFixture(1, 'Other quiz');
  const p = await join(base, other.joinCode, 'Dana');
  const r = await request(base, 'PUT', `/api/sessions/${fx.sessionId}/participants/${p.body.participant.id}/allow-rejoin`, adminToken);
  assert.equal(r.status, 404);
  assert.ok(storedHash(p.body.participant.id));
});

test('the admin results payload carries no rejoin_hash', async () => {
  const r = await request(base, 'GET', `/api/sessions/${fx.sessionId}/results`, adminToken);
  assert.equal(r.status, 200);
  assert.deepEqual(findKeys(r.body, ['rejoin_hash']), []);
});

test('after "Allow rejoin" and a new claim, the earlier holder of the row is signed out', async () => {
  const first = await join(base, fx.joinCode, 'Eva');
  assert.equal((await request(base, 'GET', '/api/my/session', first.body.token)).status, 200);
  await request(base, 'PUT', `/api/sessions/${fx.sessionId}/participants/${first.body.participant.id}/allow-rejoin`, adminToken);
  const claim = await joinWith('Eva');
  assert.equal(claim.status, 200);
  assert.equal((await request(base, 'GET', '/api/my/session', claim.body.token)).status, 200);
  const old = await request(base, 'GET', '/api/my/session', first.body.token);
  assert.equal(old.status, 401);
  assert.equal(old.body.code, 'INVALID_TOKEN');
});

test('names that differ only in case, spacing or invisible characters are the same name', async () => {
  const first = await join(base, fx.joinCode, 'Lea Marie');
  for (const lookalike of ['lea marie', 'Lea  Marie', 'Lea​ Marie', ' LEA MARIE ']) {
    const r = await joinWith(lookalike);
    assert.equal(r.status, 409, lookalike);
    assert.equal(r.body.code, 'NAME_TAKEN');
  }
  const again = await joinWith('lea marie', first.body.rejoinSecret);
  assert.equal(again.status, 200);
  assert.equal(again.body.participant.id, first.body.participant.id);
  assert.equal(again.body.participant.display_name, 'Lea Marie');
});

test('a name made only of invisible characters is rejected', async () => {
  const r = await joinWith('​‍ ');
  assert.equal(r.status, 400);
});

test('/live reports which names are open for rejoin', async () => {
  const p = await join(base, fx.joinCode, 'Finn');
  const live = async () =>
    (await request(base, 'GET', `/api/sessions/${fx.sessionId}/live`, adminToken)).body.participants.find(
      (x: { id: number }) => x.id === p.body.participant.id,
    );
  assert.equal((await live()).rejoin_open, 0);
  await request(base, 'PUT', `/api/sessions/${fx.sessionId}/participants/${p.body.participant.id}/allow-rejoin`, adminToken);
  assert.equal((await live()).rejoin_open, 1);
  await joinWith('Finn');
  assert.equal((await live()).rejoin_open, 0);
});

test('GET /api/admin/backups returns a plain list', async () => {
  const r = await request(base, 'GET', '/api/admin/backups', adminToken);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});
