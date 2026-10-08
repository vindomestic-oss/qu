import bcrypt from 'bcryptjs';
import { db } from './index';
import { seedSampleQuiz } from './seedSampleQuiz';
import { seedChidonQuiz } from './seedChidonQuiz';
import { seedChidon5787Anfaenger } from './seedChidon5787Anfaenger';
import { seedChidon5787Fortgeschrittene } from './seedChidon5787Fortgeschrittene';

const DEFAULT_PASSWORD = 'changeme123';
const isProduction = process.env.RENDER === 'true';
const envPassword = process.env.ADMIN_PASSWORD;

if (isProduction && (!envPassword || envPassword === DEFAULT_PASSWORD || envPassword.length < 12)) {
  console.error(
    'Refusing to start: set ADMIN_PASSWORD to a strong, non-default password (12+ characters) ' +
      'in the Render dashboard (service → Environment) before deploying.',
  );
  process.exit(1);
}

const username = process.env.ADMIN_USERNAME || 'admin';
const password = envPassword || DEFAULT_PASSWORD;

const existing = db.prepare('SELECT id, password_hash FROM admins WHERE username = ?').get(username) as
  | { id: number; password_hash: string }
  | undefined;
if (existing) {
  if (envPassword && !bcrypt.compareSync(envPassword, existing.password_hash)) {
    const hash = bcrypt.hashSync(envPassword, 10);
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, existing.id);
    console.log(`Admin "${username}": password updated from ADMIN_PASSWORD (not logged).`);
  } else {
    console.log(`Admin "${username}" already exists, password unchanged.`);
  }
} else {
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, hash);
  console.log(
    `Admin created: username="${username}" (password ${envPassword ? 'set from ADMIN_PASSWORD' : 'is the local dev default — see README'}, not logged).`,
  );
}

// Only auto-populate demo quizzes on truly fresh databases (no quizzes at all yet) —
// this keeps re-running `npm run seed` on a real, in-use install from re-adding them
// after someone deletes them on purpose.
const anyQuiz = db.prepare('SELECT id FROM quizzes LIMIT 1').get();
if (!anyQuiz && process.env.SEED_SAMPLE_QUIZ !== 'false') {
  seedSampleQuiz();
  seedChidonQuiz();
}

// These each skip themselves if a quiz with their title already exists, so it's safe to
// call them on every deploy — this is how new quizzes get added to the live database too.
seedChidon5787Anfaenger();
seedChidon5787Fortgeschrittene();
