import { Router } from 'express';
import { db } from '../db';
import { signGraderToken } from '../middleware/jwt';
import { createRateLimiter } from '../middleware/rateLimit';
import { nowIso } from '../lib/time';
import {
  GRADER_CODE_LENGTH,
  GRADER_NAME_MAX,
  GRADER_TOKEN_MAX_SECONDS,
  hashGraderCode,
  normalizeGraderCode,
} from '../lib/graderLinks';

/** Public: a grader exchanges the code from a grader link (or QR) and their name for a grader token. */
export const graderRouter = Router();

// 20 failed attempts per 15 minutes per client IP; successful exchanges do not count (wish 8).
const exchangeLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  message: { error: 'Too many attempts. Please wait a few minutes.', code: 'RATE_LIMITED' },
});

graderRouter.post('/exchange', exchangeLimiter, (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (name.length < 1 || name.length > GRADER_NAME_MAX) {
    return res.status(400).json({ error: `name must be 1–${GRADER_NAME_MAX} characters`, code: 'NAME_REQUIRED' });
  }
  const code = normalizeGraderCode(req.body?.code);
  const invalid = () => res.status(401).json({ error: 'invalid_or_expired_code', code: 'INVALID_OR_EXPIRED_CODE' });
  if (code.length !== GRADER_CODE_LENGTH) return invalid();

  const now = nowIso();
  const link = db
    .prepare(
      `SELECT l.id, l.session_id, l.expires_at, z.title AS quiz_title
       FROM grader_links l JOIN sessions s ON s.id = l.session_id JOIN quizzes z ON z.id = s.quiz_id
       WHERE l.code_hash = ? AND l.revoked_at IS NULL AND l.expires_at > ?`,
    )
    .get(hashGraderCode(code), now) as { id: number; session_id: number; expires_at: string; quiz_title: string } | undefined;
  if (!link) return invalid();

  const ttl = Math.min(GRADER_TOKEN_MAX_SECONDS, Math.floor((Date.parse(link.expires_at) - Date.now()) / 1000));
  if (ttl < 1) return invalid();
  db.prepare('UPDATE grader_links SET last_used_at = ? WHERE id = ?').run(now, link.id);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    token: signGraderToken({ sessionId: link.session_id, linkId: link.id, graderName: name }, ttl),
    session_id: link.session_id,
    quiz_title: link.quiz_title,
    expires_at: link.expires_at,
  });
});
