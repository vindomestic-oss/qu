import bcrypt from 'bcryptjs';
import { db } from './index';
import { seedSampleQuiz } from './seedSampleQuiz';
import { seedChidonQuiz } from './seedChidonQuiz';
import { seedChidon5787Anfaenger } from './seedChidon5787Anfaenger';
import { seedChidon5787Fortgeschrittene } from './seedChidon5787Fortgeschrittene';

const username = process.env.ADMIN_USERNAME || 'admin';
const password = process.env.ADMIN_PASSWORD || 'changeme123';

const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
if (existing) {
  console.log(`Admin "${username}" already exists, skipping.`);
} else {
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, hash);
  console.log(`Admin created: username="${username}" password="${password}"`);
  console.log('Change this password or set ADMIN_USERNAME/ADMIN_PASSWORD env vars before re-seeding.');
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
