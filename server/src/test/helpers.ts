import http from 'http';
import type { AddressInfo } from 'net';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createApp } from '../app';
import { initSocket } from '../socket';
import { db } from '../db';
import { createUniqueJoinCode } from '../lib/sessions';

export const TEST_SECRET = 'test-secret';
export const ADMIN_PASSWORD = 'test-admin-password';

export async function startServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer(createApp());
  const io = initSocket(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => io.close(() => resolve())),
  };
}

export function createAdmin(username = 'admin', password = ADMIN_PASSWORD): number {
  const result = db
    .prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)')
    .run(username, bcrypt.hashSync(password, 4));
  return Number(result.lastInsertRowid);
}

export interface QuizFixture {
  quizId: number;
  singleQuestionId: number;
  correctChoiceId: number;
  wrongChoiceId: number;
  textQuestionId: number;
  sessionId: number;
  joinCode: string;
}

/** A quiz with one single-choice question (2 choices, 1 correct), one text question and a pending session. */
export function createQuizFixture(adminId: number, title = 'Fixture quiz'): QuizFixture {
  const quizId = Number(
    db
      .prepare('INSERT INTO quizzes (title, time_limit_seconds, created_by) VALUES (?, ?, ?)')
      .run(title, 600, adminId).lastInsertRowid,
  );
  const insertQuestion = db.prepare('INSERT INTO questions (quiz_id, sort_order, type, text, points) VALUES (?, ?, ?, ?, ?)');
  const insertChoice = db.prepare('INSERT INTO choices (question_id, text, is_correct, sort_order) VALUES (?, ?, ?, ?)');
  const singleQuestionId = Number(insertQuestion.run(quizId, 0, 'single', '2 + 2 = ?', 1).lastInsertRowid);
  const wrongChoiceId = Number(insertChoice.run(singleQuestionId, '3', 0, 0).lastInsertRowid);
  const correctChoiceId = Number(insertChoice.run(singleQuestionId, '4', 1, 1).lastInsertRowid);
  const textQuestionId = Number(insertQuestion.run(quizId, 1, 'text', 'Explain gravity.', 2).lastInsertRowid);
  const joinCode = createUniqueJoinCode();
  const sessionId = Number(db.prepare('INSERT INTO sessions (quiz_id, join_code) VALUES (?, ?)').run(quizId, joinCode).lastInsertRowid);
  return { quizId, singleQuestionId, correctChoiceId, wrongChoiceId, textQuestionId, sessionId, joinCode };
}

export interface HttpResult {
  status: number;
  body: any;
}

export async function request(
  base: string,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // keep the raw text
  }
  return { status: res.status, body: parsed };
}

export async function login(base: string, username = 'admin', password = ADMIN_PASSWORD): Promise<string> {
  const r = await request(base, 'POST', '/api/auth/login', undefined, { username, password });
  if (r.status !== 200) throw new Error(`login failed: ${r.status}`);
  return r.body.token as string;
}

export async function join(base: string, joinCode: string, displayName: string): Promise<HttpResult> {
  return request(base, 'POST', '/api/join', undefined, { joinCode, displayName });
}

export function sign(payload: object, secret = TEST_SECRET, options: jwt.SignOptions = {}): string {
  return jwt.sign(payload, secret, { algorithm: 'HS256', ...options });
}

/** A token with header {"alg":"none"} and an empty signature. */
export function unsignedToken(payload: object): string {
  const enc = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(payload)}.`;
}

/** Recursively collects the paths of any forbidden key found in `value`. */
export function findKeys(value: unknown, keys: readonly string[], path = '$'): string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => found.push(...findKeys(v, keys, `${path}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (keys.includes(k)) found.push(`${path}.${k}`);
      found.push(...findKeys(v, keys, `${path}.${k}`));
    }
  }
  return found;
}

export function tableCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of ['quizzes', 'questions', 'choices', 'sessions', 'participants', 'answers']) {
    out[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  }
  return out;
}
