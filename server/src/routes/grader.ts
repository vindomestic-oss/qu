import { Router } from 'express';
import { db } from '../db';
import { signGraderToken } from '../middleware/jwt';
import { createFailureLimiter } from '../middleware/rateLimit';
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

// 20 failed lookups per 15 minutes per client IP; a valid code always passes (wish 8).
const failures = createFailureLimiter({ windowMs: 15 * 60 * 1000, limit: 20 });

graderRouter.post('/exchange', (req, res) => {
  const code = normalizeGraderCode(req.body?.code);
  const now = nowIso();
  const link =
    code.length === GRADER_CODE_LENGTH
      ? (db
          .prepare(
            `SELECT l.id, l.session_id, l.expires_at, z.title AS quiz_title
             FROM grader_links l JOIN sessions s ON s.id = l.session_id JOIN quizzes z ON z.id = s.quiz_id
             WHERE l.code_hash = ? AND l.revoked_at IS NULL AND l.expires_at > ?`,
          )
          .get(hashGraderCode(code), now) as { id: number; session_id: number; expires_at: string; quiz_title: string } | undefined)
      : undefined;
  const ttl = link ? Math.min(GRADER_TOKEN_MAX_SECONDS, Math.floor((Date.parse(link.expires_at) - Date.now()) / 1000)) : 0;

  if (!link || ttl < 1) {
    // Only failed lookups are counted and, over the limit, refused with 429.
    if (failures.blocked(req)) {
      failures.headers(req, res);
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes.', code: 'RATE_LIMITED' });
    }
    failures.fail(req);
    failures.headers(req, res);
    return res.status(401).json({ error: 'invalid_or_expired_code', code: 'INVALID_OR_EXPIRED_CODE' });
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (name.length < 1 || name.length > GRADER_NAME_MAX) {
    return res.status(400).json({ error: `name must be 1–${GRADER_NAME_MAX} characters`, code: 'NAME_REQUIRED' });
  }

  db.prepare('UPDATE grader_links SET last_used_at = ? WHERE id = ?').run(now, link.id);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    token: signGraderToken({ sessionId: link.session_id, linkId: link.id, graderName: name }, ttl),
    session_id: link.session_id,
    quiz_title: link.quiz_title,
    expires_at: link.expires_at,
  });
});
