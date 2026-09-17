import './loadEnv';

import path from 'path';
import http from 'http';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { db } from './db';
import { authRouter } from './routes/auth';
import { quizzesRouter } from './routes/quizzes';
import { questionsRouter } from './routes/questions';
import { sessionsRouter } from './routes/sessions';
import { joinRouter } from './routes/join';
import { myRouter } from './routes/my';
import { UPLOAD_DIR } from './middleware/upload';
import { initSocket } from './socket';

const CLIENT_DIST = path.join(__dirname, '..', '..', 'client', 'dist');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));

app.get('/api/health', (_req, res) => {
  const { count } = db.prepare('SELECT COUNT(*) as count FROM admins').get() as { count: number };
  res.json({ ok: true, admins: count });
});

app.use('/api/auth', authRouter);
app.use('/api/quizzes', quizzesRouter);
app.use('/api/questions', questionsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api', joinRouter);
app.use('/api/my', myRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Serve the built frontend (if present) so one process handles both API and UI.
app.use(express.static(CLIENT_DIST));
app.get('*', (_req, res, next) => {
  res.sendFile(path.join(CLIENT_DIST, 'index.html'), (err) => {
    if (err) next();
  });
});

app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err instanceof Error) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

const httpServer = http.createServer(app);
initSocket(httpServer);

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
