import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db';
import { refreshSessionStatus, SessionRow } from '../lib/sessions';
import { signParticipantToken } from '../middleware/jwt';
import { broadcastLiveUpdate } from '../socket';

export const joinRouter = Router();

interface ParticipantRow {
  id: number;
  session_id: number;
  display_name: string;
  joined_at: string;
}

// Selected explicitly: SELECT * would also return rejoin_hash.
const PARTICIPANT_COLUMNS = 'id, session_id, display_name, joined_at';

const NAME_TAKEN = {
  error: 'This name is already taken. Choose another name or ask the host.',
  code: 'NAME_TAKEN',
} as const;

function newSecret(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function secretMatches(secret: unknown, storedHash: string): boolean {
  if (typeof secret !== 'string' || !secret) return false;
  const given = Buffer.from(hashSecret(secret), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return given.length === stored.length && crypto.timingSafeEqual(given, stored);
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE';
}

joinRouter.post('/join', (req, res) => {
  const { joinCode, displayName, rejoinSecret } = req.body ?? {};
  if (typeof joinCode !== 'string' || !joinCode.trim()) {
    return res.status(400).json({ error: 'joinCode is required' });
  }
  if (typeof displayName !== 'string' || !displayName.trim()) {
    return res.status(400).json({ error: 'displayName is required' });
  }
  const name = displayName.trim().slice(0, 50);

  const sessionRow = db.prepare('SELECT * FROM sessions WHERE join_code = ?').get(joinCode.trim().toUpperCase()) as
    | SessionRow
    | undefined;
  if (!sessionRow) {
    return res.status(404).json({ error: 'Invalid join code' });
  }
  const session = refreshSessionStatus(sessionRow);
  if (session.status === 'ended') {
    return res.status(400).json({ error: 'This session has already ended' });
  }

  const existing = db
    .prepare('SELECT id, rejoin_hash FROM participants WHERE session_id = ? AND display_name = ?')
    .get(session.id, name) as { id: number; rejoin_hash: string | null } | undefined;

  let participantId: number;
  let secret: string;
  if (!existing) {
    secret = newSecret();
    try {
      const result = db
        .prepare('INSERT INTO participants (session_id, display_name, rejoin_hash) VALUES (?, ?, ?)')
        .run(session.id, name, hashSecret(secret));
      participantId = Number(result.lastInsertRowid);
    } catch (err) {
      // Two joins with the same new name at the same moment: the second one loses.
      if (isUniqueViolation(err)) return res.status(409).json(NAME_TAKEN);
      throw err;
    }
    broadcastLiveUpdate(session.id);
  } else if (existing.rejoin_hash === null) {
    secret = newSecret();
    // Guarded on NULL so two devices claiming the same row at once cannot both win.
    const claimed = db
      .prepare('UPDATE participants SET rejoin_hash = ? WHERE id = ? AND rejoin_hash IS NULL')
      .run(hashSecret(secret), existing.id);
    if (claimed.changes === 0) return res.status(409).json(NAME_TAKEN);
    participantId = existing.id;
  } else if (secretMatches(rejoinSecret, existing.rejoin_hash)) {
    secret = rejoinSecret as string;
    participantId = existing.id;
  } else {
    return res.status(409).json(NAME_TAKEN);
  }

  const participant = db
    .prepare(`SELECT ${PARTICIPANT_COLUMNS} FROM participants WHERE id = ?`)
    .get(participantId) as ParticipantRow;

  const token = signParticipantToken({
    participantId: participant.id,
    sessionId: session.id,
    displayName: participant.display_name,
  });

  res.json({ token, session, participant, rejoinSecret: secret });
});
