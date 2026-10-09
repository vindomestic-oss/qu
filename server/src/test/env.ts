// Must be the FIRST import of every test file. `node --test` runs each file in its own process,
// so every file gets a fresh in-memory database.
process.env.JWT_SECRET = 'test-secret';
process.env.QUIZ_DB_PATH = ':memory:';
