import path from 'path';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { authRouter } from './routes/auth';
import { quizzesRouter } from './routes/quizzes';
import { questionsRouter } from './routes/questions';
import { sessionsRouter } from './routes/sessions';
import { joinRouter } from './routes/join';
import { myRouter } from './routes/my';
import { adminRouter } from './routes/admin';
import { UPLOAD_DIR } from './middleware/upload';

const CLIENT_DIST = path.join(__dirname, '..', '..', 'client', 'dist');

/** Everything except the HTTP server, Socket.IO and listen(), so tests can build the app without index.ts. */
export function createApp(): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  // A day of browser caching saves ~100 iPads a revalidation round trip per picture (names are fixed,
  // so not "immutable").
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1d' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/quizzes', quizzesRouter);
  app.use('/api/questions', questionsRouter);
  app.use('/api/sessions', sessionsRouter);
  app.use('/api', joinRouter);
  app.use('/api/my', myRouter);
  app.use('/api/admin', adminRouter);

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

  return app;
}
