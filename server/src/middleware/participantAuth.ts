import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const envSecret = process.env.JWT_SECRET;
if (!envSecret) {
  throw new Error('JWT_SECRET env var is required');
}
const JWT_SECRET: string = envSecret;

export interface ParticipantTokenPayload {
  participantId: number;
  sessionId: number;
  displayName: string;
  role: 'participant';
}

export function signParticipantToken(payload: Omit<ParticipantTokenPayload, 'role'>): string {
  return jwt.sign({ ...payload, role: 'participant' }, JWT_SECRET, { expiresIn: '6h' });
}

export interface ParticipantRequest extends Request {
  participant?: ParticipantTokenPayload;
}

export function requireParticipant(req: ParticipantRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (typeof decoded !== 'object' || decoded === null || (decoded as { role?: string }).role !== 'participant') {
    return res.status(403).json({ error: 'This token cannot be used here' });
  }
  req.participant = decoded as ParticipantTokenPayload;
  next();
}
