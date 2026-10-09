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
import { sectionsRouter } from './routes/sections';
import { graderRouter } from './routes/grader';
import { gradingRouter } from './routes/grading';
import { requireStaffForSession } from './middleware/staffAuth';
import { UPLOAD_DIR } from './middleware/upload';

const CLIENT_DIST = path.join(__dirname, '..', '..', 'client', 'dist');

/** Everything except the HTTP server, Socket.IO and listen(), so tests can build the app without index.ts. */
export function createApp(): express.Express {
  const app = express();
  // Proxy hops in front of the app (Render: set after checking the real client IP). 0 = req.ip is the
  // socket address, so a forged X-Forwarded-For cannot dodge the grader-code rate limit.
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  app.set('trust proxy', Number.isInteger(hops) && hops >= 0 ? hops : 0);

  // Grader links carry a secret code in the URL (/g/<code>) and the panel shows answer keys: no
  // Referer to other sites, no search engine indexing, no caching of grading data.
  app.use((req, res, next) => {
    const p = req.path;
    if (p.startsWith('/g/') || p.startsWith('/grade') || p.startsWith('/api/grader') || p.startsWith('/api/grading')) {
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      if (p.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });

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
  app.use('/api/sections', sectionsRouter);
  app.use('/api/sessions', sessionsRouter);
  app.use('/api', joinRouter);
  app.use('/api/my', myRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/grader', graderRouter);
  app.use('/api/grading/:sessionId', requireStaffForSession, gradingRouter);

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
