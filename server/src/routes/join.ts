import { Router } from 'express';
import { db } from '../db';
import { refreshSessionStatus, SessionRow } from '../lib/sessions';
import { signParticipantToken } from '../middleware/participantAuth';
import { broadcastLiveUpdate } from '../socket';

export const joinRouter = Router();

interface ParticipantRow {
  id: number;
  session_id: number;
  display_name: string;
}

joinRouter.post('/join', (req, res) => {
  const { joinCode, displayName } = req.body ?? {};
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

  let participant = db
    .prepare('SELECT * FROM participants WHERE session_id = ? AND display_name = ?')
    .get(session.id, name) as ParticipantRow | undefined;

  if (!participant) {
    const result = db
      .prepare('INSERT INTO participants (session_id, display_name) VALUES (?, ?)')
      .run(session.id, name);
    participant = { id: Number(result.lastInsertRowid), session_id: session.id, display_name: name };
    broadcastLiveUpdate(session.id);
  }

  const token = signParticipantToken({
    participantId: participant.id,
    sessionId: session.id,
    displayName: participant.display_name,
  });

  res.json({ token, session, participant });
});
