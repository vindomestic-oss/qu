import './backupEnv';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { BACKUP_DIR, listBackups, runBackupOnce } from '../lib/backup';
import { createAdmin, createQuizFixture, tableCounts } from './helpers';

after(() => {
  fs.rmSync(path.dirname(process.env.QUIZ_DB_PATH!), { recursive: true, force: true });
});

test('runBackupOnce writes a copy that opens and has the same row counts', async () => {
  const adminId = createAdmin();
  createQuizFixture(adminId, 'Backup quiz');
  const file = await runBackupOnce(new Date('2026-10-01T10:00:00Z'));
  assert.ok(file.endsWith('quiz-2026-10-01.db'));
  const copy = new Database(file, { readonly: true });
  try {
    for (const [table, n] of Object.entries(tableCounts())) {
      assert.equal((copy.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, n, table);
    }
  } finally {
    copy.close();
  }
});

test('an existing daily file is kept unless refresh is asked for', async () => {
  const day = new Date('2026-10-02T08:00:00Z');
  const file = await runBackupOnce(day);
  const firstMtime = fs.statSync(file).mtimeMs;
  createQuizFixture(1, 'Added later');
  await runBackupOnce(day);
  assert.equal(fs.statSync(file).mtimeMs, firstMtime);
  await runBackupOnce(day, { refresh: true });
  const copy = new Database(file, { readonly: true });
  try {
    const n = (copy.prepare('SELECT COUNT(*) AS n FROM quizzes').get() as { n: number }).n;
    assert.equal(n, tableCounts().quizzes);
  } finally {
    copy.close();
  }
});

test('sixteen daily runs leave the 14 newest files and no temp files', async () => {
  for (let day = 1; day <= 16; day++) {
    await runBackupOnce(new Date(Date.UTC(2026, 10, day, 12)));
  }
  const files = listBackups().map((b) => b.file);
  assert.equal(files.length, 14);
  assert.equal(files[0], 'quiz-2026-11-16.db');
  assert.equal(files[13], 'quiz-2026-11-03.db');
  assert.deepEqual(
    fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.tmp')),
    [],
  );
});
