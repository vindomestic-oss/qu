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
}

export function signAdminToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
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
  try {
    req.admin = jwt.verify(token, JWT_SECRET) as unknown as AdminTokenPayload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
