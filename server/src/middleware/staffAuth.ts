import type { NextFunction, Request, Response } from 'express';
import { db } from '../db';
import { nowIso } from '../lib/time';
import { authenticate, bearer, MESSAGES, tokenRole } from './jwt';

/** Who is grading: an admin (any session) or a grader who entered with a link (one session). */
export type Staff = { kind: 'admin'; name: string; adminId: number } | { kind: 'grader'; name: string; linkId: number };

export interface StaffRequest extends Request {
  staff?: Staff;
  sessionId?: number;
}

/** The display string stored in answers.graded_by and grade_events.actor. */
export function staffLabel(staff: Staff): string {
  return staff.kind === 'admin' ? `admin:${staff.name}` : `${staff.name} (link #${staff.linkId})`;
}

const LAST_USED_RESOLUTION_MS = 60_000;

/**
 * The grading panel's guard (wish 8), mounted on /api/grading/:sessionId. Status contract (S0):
 * 401 without a token, with an invalid, expired or revoked one; 403 for a participant token or a
 * grader token of another session; 404 when the session does not exist. An admin token works for
 * every session. A grader token's link row is read on EVERY request, so a revoke or an expiry
 * applies to the very next request.
 */
export function requireStaffForSession(req: StaffRequest, res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Missing token', code: 'AUTH_REQUIRED' });
  const kind = tokenRole(token);
  if (!kind) return res.status(401).json({ error: MESSAGES.INVALID_TOKEN, code: 'INVALID_TOKEN' });
  if (kind.role === 'participant') return res.status(403).json({ error: MESSAGES.FORBIDDEN, code: 'FORBIDDEN' });

  const sessionId = Number(req.params.sessionId);
  if (kind.role === 'grader' && kind.payload.sessionId !== sessionId) {
    return res.status(403).json({ error: MESSAGES.FORBIDDEN, code: 'FORBIDDEN' });
  }

  const r = authenticate(token, kind.role);
  if (!r.ok) return res.status(r.status).json({ error: MESSAGES[r.code], code: r.code });

  if (!Number.isSafeInteger(sessionId) || !db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId)) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (r.role === 'admin') {
    req.staff = { kind: 'admin', name: r.admin.username, adminId: r.admin.adminId };
  } else if (r.role === 'grader') {
    req.staff = { kind: 'grader', name: r.grader.graderName, linkId: r.grader.linkId };
    // "Last used" for the admin's list of links, written at most once a minute per link.
    const now = Date.now();
    db.prepare('UPDATE grader_links SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)').run(
      nowIso(),
      r.grader.linkId,
      new Date(now - LAST_USED_RESOLUTION_MS).toISOString(),
    );
  } else {
    return res.status(403).json({ error: MESSAGES.FORBIDDEN, code: 'FORBIDDEN' });
  }
  req.sessionId = sessionId;
  next();
}
