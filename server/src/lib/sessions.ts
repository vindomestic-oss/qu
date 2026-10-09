import { randomInt } from 'crypto';
import { db } from '../db';
import { broadcastGradingChanged, broadcastSessionUpdate } from '../socket';

export interface SessionRow {
  id: number;
  quiz_id: number;
  join_code: string;
  status: 'pending' | 'active' | 'ended';
  started_at: string | null;
  ends_at: string | null;
  created_at: string;
  joining_locked: number;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 to avoid ambiguity

function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[randomInt(CODE_CHARS.length)];
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

type EndHook = (sessionId: number) => void;
const endHooks: EndHook[] = [];

/** Runs after a session has ended (once per session). Later steps register follow-up work here. */
export function onSessionEnded(hook: EndHook): void {
  endHooks.push(hook);
}

/**
 * The only way a session ends: by the host, by its timer, by the 30 s sweep or by the lazy check on
 * read. In one transaction it marks the session ended and submits everyone who has not pressed
 * Finish ("session_end"). Broadcasts only if this call actually ended it. Returns the fresh row.
 */
export function finalizeSession(sessionId: number, endedAtIso: string): SessionRow | null {
  const changed = db.transaction(() => {
    const r = db
      .prepare("UPDATE sessions SET status = 'ended', ends_at = ? WHERE id = ? AND status <> 'ended'")
      .run(endedAtIso, sessionId);
    if (r.changes === 0) return false;
    db.prepare(
      "UPDATE participants SET submitted_at = ?, submit_source = 'session_end' WHERE session_id = ? AND submitted_at IS NULL",
    ).run(endedAtIso, sessionId);
    return true;
  })();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
  if (changed && row) {
    broadcastSessionUpdate(sessionId, row);
    broadcastGradingChanged(sessionId, { kind: 'session_end' });
    for (const hook of endHooks) {
      try {
        hook(sessionId);
      } catch (err) {
        console.error('session end hook failed:', err instanceof Error ? err.message : err);
      }
    }
  }
  return row ?? null;
}

/** Lazily ends an active session whose end time has passed. Returns the up-to-date row. */
export function refreshSessionStatus(session: SessionRow): SessionRow {
  if (session.status === 'active' && session.ends_at && new Date(session.ends_at).getTime() <= Date.now()) {
    return finalizeSession(session.id, session.ends_at) ?? { ...session, status: 'ended' };
  }
  return session;
}

export function getSession(id: number): SessionRow | null {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  if (!row) return null;
  return refreshSessionStatus(row);
}
