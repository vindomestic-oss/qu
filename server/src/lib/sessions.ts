import { db } from '../db';

export interface SessionRow {
  id: number;
  quiz_id: number;
  join_code: string;
  status: 'pending' | 'active' | 'ended';
  started_at: string | null;
  ends_at: string | null;
  created_at: string;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 to avoid ambiguity

function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export function createUniqueJoinCode(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateJoinCode();
    const existing = db.prepare('SELECT id FROM sessions WHERE join_code = ?').get(code);
    if (!existing) return code;
  }
  throw new Error('Could not generate a unique join code');
}

/** Lazily flips an active session to 'ended' if its end time has passed. Returns the up-to-date row. */
export function refreshSessionStatus(session: SessionRow): SessionRow {
  if (session.status === 'active' && session.ends_at && new Date(session.ends_at).getTime() <= Date.now()) {
    db.prepare("UPDATE sessions SET status = 'ended' WHERE id = ?").run(session.id);
    return { ...session, status: 'ended' };
  }
  return session;
}

export function getSession(id: number): SessionRow | null {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  if (!row) return null;
  return refreshSessionStatus(row);
}
