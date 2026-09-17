import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db';
import { signAdminToken, requireAdmin, AuthedRequest } from '../middleware/auth';

export const authRouter = Router();

interface AdminRow {
  id: number;
  username: string;
  password_hash: string;
}

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const admin = db.prepare('SELECT id, username, password_hash FROM admins WHERE username = ?').get(username) as
    | AdminRow
    | undefined;
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = signAdminToken({ adminId: admin.id, username: admin.username });
  res.json({ token, username: admin.username });
});

authRouter.get('/me', requireAdmin, (req: AuthedRequest, res) => {
  res.json({ admin: req.admin });
});
