import './env';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { getQuizLanguageInfo } from '../lib/quizLanguages';

const SERVER_DIR = path.join(__dirname, '..', '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qu-seed-test-'));
let dbCounter = 0;

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function freshDbPath(): string {
  dbCounter += 1;
  return path.join(tmpDir, `seed-${dbCounter}.db`);
}

/** Runs the real seed script in a child process. process.env is not spread, so server/.env cannot fill anything in. */
function runSeed(dbPath: string, adminPassword: string, render: string) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/db/seed.ts'], {
    cwd: SERVER_DIR,
    encoding: 'utf-8',
    env: {
      PATH: process.env.PATH,
      QUIZ_DB_PATH: dbPath,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: adminPassword,
      RENDER: render,
      SEED_SAMPLE_QUIZ: 'false',
    },
  });
  return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
}

function adminRow(dbPath: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare('SELECT password_hash, tokens_valid_after FROM admins WHERE username = ?').get('admin') as
      | { password_hash: string; tokens_valid_after: string | null }
      | undefined;
  } finally {
    db.close();
  }
}

for (const [label, pw] of [
  ['empty', ''],
  ['the development default', 'changeme123'],
  ['a 10-character password', 'abcdefghij'],
  ['a short password padded with spaces', 'abc          '],
] as const) {
  test(`production refuses ${label} ADMIN_PASSWORD`, () => {
    const dbPath = freshDbPath();
    const r = runSeed(dbPath, pw, 'true');
    assert.equal(r.status, 1);
    assert.match(r.output, /Refusing to start/);
    assert.equal(adminRow(dbPath), undefined);
  });
}

test('a strong password is stored, never printed, and rotates with tokens_valid_after', () => {
  const dbPath = freshDbPath();
  const first = 'Strong-Password-One-2026';
  const r1 = runSeed(dbPath, first, 'true');
  assert.equal(r1.status, 0, r1.output);
  assert.ok(!r1.output.includes(first), 'the password must not appear in the output');
  const row1 = adminRow(dbPath)!;
  assert.ok(bcrypt.compareSync(first, row1.password_hash));
  assert.ok(row1.tokens_valid_after);

  const second = 'Strong-Password-Two-2026';
  const r2 = runSeed(dbPath, second, 'true');
  assert.equal(r2.status, 0, r2.output);
  assert.ok(!r2.output.includes(second));
  const row2 = adminRow(dbPath)!;
  assert.ok(bcrypt.compareSync(second, row2.password_hash));
  assert.ok(Date.parse(row2.tokens_valid_after!) > Date.parse(row1.tokens_valid_after!));
});

test('local development without ADMIN_PASSWORD starts with a warning', () => {
  const dbPath = freshDbPath();
  const r = runSeed(dbPath, '', '');
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, /ADMIN_PASSWORD is not set/);
  assert.ok(adminRow(dbPath));
});

test('seeded quizzes declare exactly the languages they contain; the 5787 quizzes offer only Deutsch', () => {
  const dbPath = freshDbPath();
  const seedAll = () =>
    spawnSync(process.execPath, ['--import', 'tsx', 'src/db/seed.ts'], {
      cwd: SERVER_DIR,
      encoding: 'utf-8',
      env: { PATH: process.env.PATH, QUIZ_DB_PATH: dbPath, UPLOAD_DIR: path.join(tmpDir, 'uploads'), ADMIN_USERNAME: 'admin' },
    });
  const first = seedAll();
  assert.equal(first.status, 0, first.stderr);

  const read = () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db.prepare('SELECT id, title, base_language, content_languages FROM quizzes ORDER BY id').all() as {
        id: number;
        title: string;
        base_language: string;
        content_languages: string;
      }[];
      return rows.map((r) => ({
        title: r.title,
        declared: JSON.parse(r.content_languages),
        offered: getQuizLanguageInfo(db, r).offered,
      }));
    } finally {
      db.close();
    }
  };
  const quizzes = read();
  const byTitle = (re: RegExp) => quizzes.find((q) => re.test(q.title))!;
  assert.deepEqual(byTitle(/World Geography/).declared, ['en', 'de', 'he', 'ru', 'fr', 'lt', 'pl']);
  assert.deepEqual(byTitle(/5786/).declared, ['en', 'de', 'ru', 'cs', 'es', 'it', 'lv', 'lt', 'hu', 'fi', 'bg', 'uk']);
  assert.deepEqual(byTitle(/5786/).offered, ['en', 'de', 'ru', 'cs', 'es', 'it', 'lv', 'lt', 'hu', 'fi', 'bg', 'uk']);
  for (const re of [/5787 – Anfänger/, /5787 – Fortgeschrittene/]) {
    assert.deepEqual(byTitle(re).declared, ['de']);
    assert.deepEqual(byTitle(re).offered, ['de']);
  }

  // The next boot (seed again, which also runs the migrations) changes nothing.
  const second = seedAll();
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(read(), quizzes);
});
