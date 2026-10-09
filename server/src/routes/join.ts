import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db';
import { refreshSessionStatus, SessionRow } from '../lib/sessions';
import { signParticipantToken } from '../middleware/jwt';
import { broadcastLiveUpdate, revalidateRooms } from '../socket';
import { nameKey, normalizeDisplayName } from '../lib/names';

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
    return res.status(400).json({ error: 'joinCode is required', code: 'JOIN_CODE_REQUIRED' });
  }
  const name = typeof displayName === 'string' ? normalizeDisplayName(displayName) : '';
  if (!name) {
    return res.status(400).json({ error: 'displayName is required', code: 'NAME_REQUIRED' });
  }

  // Tolerant input: lower case, spaces and hyphens are fine ("abc-234"); the client maps Cyrillic look-alikes.
  const code = joinCode.replace(/[\s-]/g, '').toUpperCase();
  const sessionRow = db.prepare('SELECT * FROM sessions WHERE join_code = ?').get(code) as
    | SessionRow
    | undefined;
  if (!sessionRow) {
    return res.status(404).json({ error: 'Invalid join code', code: 'INVALID_CODE' });
  }
  const session = refreshSessionStatus(sessionRow);
  if (session.status === 'ended') {
    return res.status(400).json({ error: 'This session has already ended', code: 'SESSION_ENDED' });
  }

  // Names that differ only in case, spacing or invisible characters count as the same name, so a
  // look-alike row cannot sit next to the real one in the host's list.
  const key = nameKey(name);
  const existing = (
    db.prepare('SELECT id, display_name, rejoin_hash FROM participants WHERE session_id = ?').all(session.id) as {
      id: number;
      display_name: string;
      rejoin_hash: string | null;
    }[]
  ).find((p) => nameKey(p.display_name) === key);

  let participantId: number;
  let secret: string;
  if (!existing && session.joining_locked) {
    // People already in the session can still rejoin above; only new names are stopped.
    return res.status(403).json({ error: 'Joining is closed', code: 'JOINING_LOCKED' });
  }
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
    // Guarded on NULL so two devices claiming the same row at once cannot both win. The new
    // token_version signs out whoever held the row before.
    const claimed = db
      .prepare('UPDATE participants SET rejoin_hash = ?, token_version = token_version + 1 WHERE id = ? AND rejoin_hash IS NULL')
      .run(hashSecret(secret), existing.id);
    if (claimed.changes === 0) return res.status(409).json(NAME_TAKEN);
    participantId = existing.id;
    // The previous holder of this row is signed out (token_version); take its socket out of the room too.
    revalidateRooms(session.id);
    broadcastLiveUpdate(session.id);
  } else if (secretMatches(rejoinSecret, existing.rejoin_hash)) {
    secret = rejoinSecret as string;
    participantId = existing.id;
  } else {
    return res.status(409).json(NAME_TAKEN);
  }

  const participant = db
    .prepare(`SELECT ${PARTICIPANT_COLUMNS} FROM participants WHERE id = ?`)
    .get(participantId) as ParticipantRow;
  const { token_version } = db.prepare('SELECT token_version FROM participants WHERE id = ?').get(participantId) as {
    token_version: number;
  };

  const token = signParticipantToken({
    participantId: participant.id,
    sessionId: session.id,
    displayName: participant.display_name,
    tokenVersion: token_version,
  });

  res.json({ token, session, participant, rejoinSecret: secret });
});
