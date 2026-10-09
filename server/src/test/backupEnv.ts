// First import of backup.test.ts: a file database (db.backup() cannot copy ':memory:' to a path
// that we then reopen) and a private backup folder.
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qu-backup-test-'));
process.env.JWT_SECRET = 'test-secret';
process.env.QUIZ_DB_PATH = path.join(dir, 'quiz.db');
process.env.BACKUP_DIR = path.join(dir, 'backups');
