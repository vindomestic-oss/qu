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
}

export function signParticipantToken(payload: ParticipantTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '6h' });
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
  try {
    req.participant = jwt.verify(token, JWT_SECRET) as unknown as ParticipantTokenPayload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
