import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db';

// The only file that reads JWT_SECRET. One secret for every token kind on purpose: an explicit
// `role` claim plus mutually exclusive shape checks keep the kinds apart (RFC 8725 §3.11, §3.12).
const envSecret = process.env.JWT_SECRET;
if (!envSecret) throw new Error('JWT_SECRET env var is required');
const JWT_SECRET: string = envSecret;

export type TokenRole = 'admin' | 'participant' | 'grader';
export interface AdminIdentity {
  adminId: number;
  username: string;
}
export interface ParticipantIdentity {
  participantId: number;
  sessionId: number;
  displayName: string;
}
export type AuthResult =
  | { ok: true; role: 'admin'; admin: AdminIdentity }
  | { ok: true; role: 'participant'; participant: ParticipantIdentity }
  | { ok: false; status: 401 | 403; code: 'INVALID_TOKEN' | 'FORBIDDEN' };

export function signAdminToken(p: AdminIdentity): string {
  return jwt.sign({ role: 'admin', adminId: p.adminId, username: p.username }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '12h',
  });
}

export function signParticipantToken(p: ParticipantIdentity): string {
  return jwt.sign(
    { role: 'participant', participantId: p.participantId, sessionId: p.sessionId, displayName: p.displayName },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '6h' },
  );
}
// S12 (wish 8) adds signGraderToken(...) with role 'grader' here.

function verifySignature(token: string): Record<string, unknown> | null {
  try {
    const d = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    return typeof d === 'object' && d !== null ? (d as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Mutually exclusive shapes; legacy tokens (no role) are classified by shape. */
export function classifyPayload(p: Record<string, unknown>): TokenRole | null {
  const adminShape =
    Number.isInteger(p.adminId) && typeof p.username === 'string' && p.participantId === undefined && p.sessionId === undefined;
  const participantShape =
    Number.isInteger(p.participantId) &&
    Number.isInteger(p.sessionId) &&
    typeof p.displayName === 'string' &&
    p.adminId === undefined;
  if (p.role === 'admin') return adminShape ? 'admin' : null;
  if (p.role === 'participant') return participantShape ? 'participant' : null;
  if (p.role === 'grader') return 'grader'; // only requireStaffForSession (S12) accepts it
  if (p.role !== undefined) return null;
  return adminShape ? 'admin' : participantShape ? 'participant' : null;
}

/** Signature, kind and database checks. Used by the HTTP middlewares and by socket.ts. */
export function authenticate(token: string, want: 'admin' | 'participant'): AuthResult {
  const p = verifySignature(token);
  const role = p ? classifyPayload(p) : null;
  if (!p || role === null) return { ok: false, status: 401, code: 'INVALID_TOKEN' };
  if (role !== want) return { ok: false, status: 403, code: 'FORBIDDEN' };
  if (role === 'admin') {
    const row = db.prepare('SELECT id, username, tokens_valid_after FROM admins WHERE id = ?').get(p.adminId) as
      | { id: number; username: string; tokens_valid_after: string | null }
      | undefined;
    if (!row || row.username !== p.username) return { ok: false, status: 401, code: 'INVALID_TOKEN' };
    if (row.tokens_valid_after) {
      const cutoff = Math.floor(Date.parse(row.tokens_valid_after) / 1000);
      if (typeof p.iat !== 'number' || p.iat < cutoff) return { ok: false, status: 401, code: 'INVALID_TOKEN' };
    }
    return { ok: true, role: 'admin', admin: { adminId: row.id, username: row.username } };
  }
  const row = db
    .prepare('SELECT id FROM participants WHERE id = ? AND session_id = ? AND display_name = ?')
    .get(p.participantId, p.sessionId, p.displayName);
  if (!row) return { ok: false, status: 401, code: 'INVALID_TOKEN' };
  return {
    ok: true,
    role: 'participant',
    participant: {
      participantId: p.participantId as number,
      sessionId: p.sessionId as number,
      displayName: p.displayName as string,
    },
  };
}

function bearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  const t = h?.startsWith('Bearer ') ? h.slice(7).trim() : '';
  return t || undefined;
}

const MESSAGES = { INVALID_TOKEN: 'Invalid or expired token', FORBIDDEN: 'This token cannot be used here' };

export interface AuthedRequest extends Request {
  admin?: AdminIdentity;
}
export interface ParticipantRequest extends Request {
  participant?: ParticipantIdentity;
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Missing token', code: 'AUTH_REQUIRED' });
  const r = authenticate(token, 'admin');
  if (!r.ok) return res.status(r.status).json({ error: MESSAGES[r.code], code: r.code });
  if (r.role !== 'admin') return res.status(403).json({ error: MESSAGES.FORBIDDEN, code: 'FORBIDDEN' });
  req.admin = r.admin;
  next();
}

export function requireParticipant(req: ParticipantRequest, res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Missing token', code: 'AUTH_REQUIRED' });
  const r = authenticate(token, 'participant');
  if (!r.ok) return res.status(r.status).json({ error: MESSAGES[r.code], code: r.code });
  if (r.role !== 'participant') return res.status(403).json({ error: MESSAGES.FORBIDDEN, code: 'FORBIDDEN' });
  req.participant = r.participant;
  next();
}
