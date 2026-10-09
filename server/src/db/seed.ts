import '../loadEnv'; // local server/.env; on Render the dashboard provides the env
import bcrypt from 'bcryptjs';
import { db } from './index';
import { nowIso } from '../lib/time';
import { seedSampleQuiz } from './seedSampleQuiz';
import { seedChidonQuiz, syncChidonPictures } from './seedChidonQuiz';
import { seedChidon5787Anfaenger } from './seedChidon5787Anfaenger';
import { seedChidon5787Fortgeschrittene } from './seedChidon5787Fortgeschrittene';

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
const DEV_DEFAULT_PASSWORD = 'changeme123'; // local development only; refused in production
const username = process.env.ADMIN_USERNAME || 'admin';
const envPassword = process.env.ADMIN_PASSWORD?.trim() ? process.env.ADMIN_PASSWORD : undefined;
// Strength is judged without surrounding spaces, so padding cannot pass a weak password.
const trimmedPassword = envPassword?.trim();

if (
  IS_PRODUCTION &&
  (!trimmedPassword || trimmedPassword === DEV_DEFAULT_PASSWORD || trimmedPassword.length < 12)
) {
  console.error(
    'Refusing to start: set ADMIN_PASSWORD (12+ characters, not the development default) in the Render dashboard.',
  );
  process.exit(1);
}
if (!envPassword) console.warn('ADMIN_PASSWORD is not set: using the local development default.');
const password = envPassword ?? DEV_DEFAULT_PASSWORD;

// The password is never logged.
const existing = db.prepare('SELECT id, password_hash FROM admins WHERE username = ?').get(username) as
  | { id: number; password_hash: string }
  | undefined;
if (!existing) {
  db.prepare('INSERT INTO admins (username, password_hash, tokens_valid_after) VALUES (?, ?, ?)').run(
    username,
    bcrypt.hashSync(password, 10),
    nowIso(),
  );
  console.log(`Admin "${username}" created.`);
} else if (envPassword && !bcrypt.compareSync(envPassword, existing.password_hash)) {
  db.prepare('UPDATE admins SET password_hash = ?, tokens_valid_after = ? WHERE id = ?').run(
    bcrypt.hashSync(envPassword, 10),
    nowIso(),
    existing.id,
  );
  console.log(`Admin "${username}": password updated from ADMIN_PASSWORD; earlier admin logins are signed out.`);
} else {
  console.log(`Admin "${username}" exists; password unchanged.`);
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
syncChidonPictures();
