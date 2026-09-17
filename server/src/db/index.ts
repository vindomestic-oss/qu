import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { runMigrations } from './migrate';

const DB_PATH = path.join(__dirname, '..', '..', 'quiz.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
db.exec(schema);
runMigrations(db);
