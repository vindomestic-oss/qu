CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quizzes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  title_de TEXT,
  title_ru TEXT,
  title_fr TEXT,
  title_pl TEXT,
  title_lt TEXT,
  title_he TEXT,
  description TEXT,
  description_de TEXT,
  description_ru TEXT,
  description_fr TEXT,
  description_pl TEXT,
  description_lt TEXT,
  description_he TEXT,
  time_limit_seconds INTEGER NOT NULL,
  created_by INTEGER NOT NULL REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('single', 'multiple', 'text')),
  text TEXT NOT NULL,
  text_de TEXT,
  text_ru TEXT,
  text_fr TEXT,
  text_pl TEXT,
  text_lt TEXT,
  text_he TEXT,
  image_path TEXT,
  points INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS choices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  text_de TEXT,
  text_ru TEXT,
  text_fr TEXT,
  text_pl TEXT,
  text_lt TEXT,
  text_he TEXT,
  is_correct INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  join_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'ended')) DEFAULT 'pending',
  started_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, display_name)
);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  selected_choice_ids TEXT,
  text_answer TEXT,
  is_correct INTEGER,
  points_awarded INTEGER,
  graded_at TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (participant_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_questions_quiz ON questions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_choices_question ON choices(question_id);
CREATE INDEX IF NOT EXISTS idx_participants_session ON participants(session_id);
CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id);
CREATE INDEX IF NOT EXISTS idx_answers_participant ON answers(participant_id);

-- Rubrics (wish 10, S11): author-defined groups of a quiz's questions. Translations (name_<lang>)
-- and questions.section_id come from migrate.ts; colour = position among the quiz's rubrics.
CREATE TABLE IF NOT EXISTS quiz_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sections_quiz ON quiz_sections(quiz_id);
-- Grader access (wish 8): a revocable, expiring code for one session. Only the sha256 of the
-- normalised code is stored. Timestamps are ISO-8601 UTC written from JS (no SQL defaults).
CREATE TABLE IF NOT EXISTS grader_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  created_by INTEGER REFERENCES admins(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_grader_links_session ON grader_links(session_id);

-- Append-only audit of every grade change (wish 8; wish 7 adds AI actions). One row per change,
-- written in the same transaction as the change. actions: 'manual' | 'regrade_points'.
CREATE TABLE IF NOT EXISTS grade_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  answer_id INTEGER NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL,
  actor TEXT,
  action TEXT,
  old_points REAL,
  new_points REAL,
  is_correct INTEGER,
  grade_source TEXT,
  ai_run_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grade_events_answer ON grade_events(answer_id);
CREATE INDEX IF NOT EXISTS idx_grade_events_session ON grade_events(session_id);
