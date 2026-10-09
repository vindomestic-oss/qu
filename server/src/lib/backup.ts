import fs from 'fs';
import path from 'path';
import { db, DB_PATH } from '../db';

/** Daily copies of the database next to it (on Render's disk: /var/data/backups). */
export const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');
const KEEP = 14;
const FIRST_RUN_DELAY_MS = 60_000;
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const FILE_PATTERN = /^quiz-\d{4}-\d{2}-\d{2}\.db$/;

export interface BackupFile {
  file: string;
  size: number;
  createdAt: string;
}

function fileNameFor(date: Date): string {
  return `quiz-${date.toISOString().slice(0, 10)}.db`;
}

/** Newest first. The UTC date in the file name sorts the same way as the files were made. */
export function listBackups(): BackupFile[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => FILE_PATTERN.test(f))
    .sort()
    .reverse()
    .map((file) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, file));
      return { file, size: stat.size, createdAt: stat.mtime.toISOString() };
    });
}

function rotate(): void {
  for (const old of listBackups().slice(KEEP)) {
    fs.unlinkSync(path.join(BACKUP_DIR, old.file));
  }
}

let tmpCounter = 0;

/**
 * Writes today's (UTC) backup unless it already exists, then keeps the 14 newest. With `refresh`,
 * today's file is rewritten from the current state. Returns the file path.
 */
export async function runBackupOnce(now: Date = new Date(), { refresh = false } = {}): Promise<string> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = fileNameFor(now);
  const finalPath = path.join(BACKUP_DIR, file);
  if (refresh || !fs.existsSync(finalPath)) {
    tmpCounter += 1;
    const tmpPath = `${finalPath}.${process.pid}-${tmpCounter}.tmp`;
    try {
      await db.backup(tmpPath);
      fs.renameSync(tmpPath, finalPath);
    } finally {
      fs.rmSync(tmpPath, { force: true });
    }
    console.log(`Backup written: ${file} (${fs.statSync(finalPath).size} bytes)`);
  }
  rotate();
  return finalPath;
}

/** Server process only (never the seed or tests): first run 60 s after boot, then every 24 h. */
export function scheduleBackups(): void {
  if (DB_PATH === ':memory:') return;
  const run = () => {
    runBackupOnce().catch((err) => console.error('Backup failed:', err instanceof Error ? err.message : err));
  };
  setTimeout(() => {
    run();
    setInterval(run, INTERVAL_MS).unref();
  }, FIRST_RUN_DELAY_MS).unref();
}
