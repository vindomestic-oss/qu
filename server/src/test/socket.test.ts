import './env';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect, type Socket } from 'socket.io-client';
import { createAdmin, createQuizFixture, join, login, request, sign, startServer, type QuizFixture } from './helpers';

let base = '';
let close: () => Promise<void>;
let adminToken: string;
let a: QuizFixture;
let b: QuizFixture;
let participantA: { token: string; id: number };
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

function joinRoom(s: Socket, payload: unknown): Promise<{ ok: boolean; error?: string }> {
  return s.timeout(2000).emitWithAck('session:join', payload);
}

before(async () => {
  ({ base, close } = await startServer());
  const adminId = createAdmin();
  adminToken = await login(base);
  a = createQuizFixture(adminId, 'Socket quiz A');
  b = createQuizFixture(adminId, 'Socket quiz B');
  const joined = await join(base, a.joinCode, 'Socket Kid');
  participantA = { token: joined.body.token, id: joined.body.participant.id };
});

after(async () => {
  for (const s of sockets) s.disconnect();
  await close();
});

test('the old bare-number form is refused', async () => {
  const s = await open();
  assert.equal((await joinRoom(s, a.sessionId)).ok, false);
});

test('a participant may join only its own session room', async () => {
  const s = await open();
  assert.equal((await joinRoom(s, { sessionId: b.sessionId, token: participantA.token })).ok, false);
  assert.equal((await joinRoom(s, { sessionId: a.sessionId, token: participantA.token })).ok, true);
});

test('an admin may join any session room', async () => {
  const s = await open();
  assert.equal((await joinRoom(s, { sessionId: a.sessionId, token: adminToken })).ok, true);
  assert.equal((await joinRoom(s, { sessionId: b.sessionId, token: adminToken })).ok, true);
});

test('a legacy participant token (no role) may join its own session room', async () => {
  const s = await open();
  const legacy = sign({ participantId: participantA.id, sessionId: a.sessionId, displayName: 'Socket Kid' });
  assert.equal((await joinRoom(s, { sessionId: a.sessionId, token: legacy })).ok, true);
});

test('broadcasts reach only sockets that were allowed into the room', async () => {
  const x = await open();
  const y = await open();
  assert.equal((await joinRoom(x, { sessionId: b.sessionId, token: participantA.token })).ok, false);
  assert.equal((await joinRoom(y, { sessionId: b.sessionId, token: adminToken })).ok, true);

  let xGot = false;
  x.on('session:update', () => {
    xGot = true;
  });
  const yGot = new Promise<{ id: number; status: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('admin socket got no session:update within 1 s')), 1000);
    y.once('session:update', (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

  assert.equal((await request(base, 'PUT', `/api/sessions/${b.sessionId}/start`, adminToken)).status, 200);
  const update = await yGot;
  assert.equal(update.id, b.sessionId);
  assert.equal(update.status, 'active');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(xGot, false);
});
