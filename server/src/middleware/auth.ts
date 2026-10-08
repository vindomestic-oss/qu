import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const envSecret = process.env.JWT_SECRET;
if (!envSecret) {
  throw new Error('JWT_SECRET env var is required');
}
const JWT_SECRET: string = envSecret;

export interface AdminTokenPayload {
  adminId: number;
  username: string;
  role: 'admin';
}

export function signAdminToken(payload: Omit<AdminTokenPayload, 'role'>): string {
  return jwt.sign({ ...payload, role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
}

export interface AuthedRequest extends Request {
  admin?: AdminTokenPayload;
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
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
  if (typeof decoded !== 'object' || decoded === null || (decoded as { role?: string }).role !== 'admin') {
    return res.status(403).json({ error: 'This token cannot be used here' });
  }
  req.admin = decoded as AdminTokenPayload;
  next();
}
