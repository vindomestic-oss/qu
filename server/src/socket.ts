import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { authenticate } from './middleware/jwt';
import { db } from './db';
import { nowIso } from './lib/time';
import { invalidateSessionCache, invalidateSessionPart } from './lib/gradingCache';

// Rooms: `session:<id>` (participants and staff) carries only session:update. `staff:<id>` (admins, and
// graders with a valid link for that one session) carries session:update, session:live and
// grading:changed. Graders are also in `graders:<id>`, so session:update reaches them without the
// join code (they never need it to grade). This module imports no route or lib/sessions.ts; the
// broadcast helpers do nothing until initSocket has run.

let io: Server | undefined;

type Ack = (r: object) => void;
type RoomGrant = { kind: 'session' | 'staff'; sessionId: number; token: string };

/**
 * Who may be in a room, re-checked later: the token can expire, a participant row be reclaimed, a
 * grader link be revoked or expire. Returns the grader link id for a grader in the staff room.
 */
function mayJoin(kind: 'session' | 'staff', sessionId: number, token: string): boolean | { linkId: number } {
  const asAdmin = authenticate(token, 'admin');
  if (asAdmin.ok) return true;
  if (kind === 'staff') {
    const asGrader = authenticate(token, 'grader');
    return asGrader.ok && asGrader.role === 'grader' && asGrader.grader.sessionId === sessionId
      ? { linkId: asGrader.grader.linkId }
      : false;
  }
  const asParticipant = authenticate(token, 'participant');
  return asParticipant.ok && asParticipant.role === 'participant' && asParticipant.participant.sessionId === sessionId;
}

function grants(socket: { data: { grants?: Map<string, RoomGrant> } }): Map<string, RoomGrant> {
  socket.data.grants ??= new Map();
  return socket.data.grants;
}

function toAck(ack: unknown): Ack {
  return typeof ack === 'function' ? (ack as Ack) : () => {};
}

function readPayload(payload: unknown): { sessionId?: unknown; token?: unknown } {
  return (typeof payload === 'object' && payload !== null ? payload : {}) as { sessionId?: unknown; token?: unknown };
}

export function initSocket(server: HttpServer): Server {
  io = new Server(server, { cors: { origin: '*' } });

  // The connection itself grants nothing; every room join is authorised.
  io.on('connection', (socket) => {
    socket.on('session:join', (payload: unknown, ack?: unknown) => {
      const reply = toAck(ack);
      const p = readPayload(payload);
      if (!Number.isInteger(p.sessionId) || typeof p.token !== 'string') {
        return reply({ ok: false, error: 'TOKEN_REQUIRED' }); // also the old bare-number form
      }
      const sessionId = p.sessionId as number;
      if (!mayJoin('session', sessionId, p.token)) return reply({ ok: false, error: 'FORBIDDEN' });
      socket.join(`session:${sessionId}`);
      grants(socket).set(`session:${sessionId}`, { kind: 'session', sessionId, token: p.token });
      reply({ ok: true });
    });

    socket.on('session:leave', (payload: unknown) => {
      const p = readPayload(payload);
      if (!Number.isInteger(p.sessionId)) return;
      socket.leave(`session:${p.sessionId}`);
      grants(socket).delete(`session:${p.sessionId}`);
    });

    // Staff room: admins for any session, graders for the session of their link.
    socket.on('staff:join', (payload: unknown, ack?: unknown) => {
      const reply = toAck(ack);
      const p = readPayload(payload);
      if (!Number.isInteger(p.sessionId) || typeof p.token !== 'string') {
        return reply({ ok: false, error: 'TOKEN_REQUIRED' });
      }
      const sessionId = p.sessionId as number;
      if (!db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId)) return reply({ ok: false, error: 'NOT_FOUND' });
      const allowed = mayJoin('staff', sessionId, p.token);
      if (!allowed) return reply({ ok: false, error: 'FORBIDDEN' });
      // Revoking a link disconnects the sockets that carry its id (disconnectGraderLink).
      if (typeof allowed === 'object') {
        socket.data.linkId = allowed.linkId;
        socket.join(`graders:${sessionId}`);
      } else {
        socket.leave(`graders:${sessionId}`);
      }
      socket.join(`staff:${sessionId}`);
      grants(socket).set(`staff:${sessionId}`, { kind: 'staff', sessionId, token: p.token });
      reply({ ok: true });
    });

    socket.on('staff:leave', (payload: unknown) => {
      const p = readPayload(payload);
      if (!Number.isInteger(p.sessionId)) return;
      socket.leave(`staff:${p.sessionId}`);
      socket.leave(`graders:${p.sessionId}`);
      grants(socket).delete(`staff:${p.sessionId}`);
    });
  });

  return io;
}

/**
 * Removes sockets from rooms their token no longer allows: expired tokens, a changed admin password,
 * a participant row claimed by another device. Run by the 30 s sweep, and at once for one session
 * after a claim. A client that still holds a valid token simply joins again on its next reconnect.
 */
export function revalidateRooms(onlySessionId?: number): void {
  if (!io) return;
  for (const socket of io.sockets.sockets.values()) {
    for (const [room, g] of grants(socket)) {
      if (onlySessionId !== undefined && g.sessionId !== onlySessionId) continue;
      if (!mayJoin(g.kind, g.sessionId, g.token)) {
        socket.leave(room);
        if (g.kind === 'staff') socket.leave(`graders:${g.sessionId}`);
        grants(socket).delete(room);
      }
    }
  }
}

export function getIo(): Server | undefined {
  return io;
}

/** A revoked grader link: its open panels lose the staff room at once (the HTTP API already refuses it). */
export async function disconnectGraderLink(sessionId: number, linkId: number): Promise<number> {
  if (!io) return 0;
  const sockets = (await io.in(`staff:${sessionId}`).fetchSockets()).filter((s) => s.data.linkId === linkId);
  for (const s of sockets) s.disconnect(true);
  return sockets.length;
}

/**
 * Session status changes go to everyone in the session, participants and staff alike; graders get
 * the row without its join code. Every payload carries server_now (ISO), so screens can correct
 * their countdowns for a device clock that is off (S15; display only, the server ends the session).
 */
export function broadcastSessionUpdate(sessionId: number, payload: unknown) {
  // The grading panel's cached session data is stale from here on (lib/gradingCache.ts).
  invalidateSessionCache(sessionId);
  if (!io) return;
  const stamped = typeof payload === 'object' && payload !== null ? { ...payload, server_now: nowIso() } : payload;
  io.to(`session:${sessionId}`).to(`staff:${sessionId}`).except(`graders:${sessionId}`).emit('session:update', stamped);
  const forGraders =
    typeof stamped === 'object' && stamped !== null
      ? Object.fromEntries(Object.entries(stamped).filter(([key]) => key !== 'join_code'))
      : stamped;
  io.to(`graders:${sessionId}`).emit('session:update', forGraders);
}

const LIVE_WINDOW_MS = 500;
const liveWindows = new Map<number, { timer: NodeJS.Timeout; dirty: boolean }>();

function emitLive(sessionId: number) {
  // Staff screens refetch the summary on this event; an entry computed before the answer save or join
  // that caused it must not answer those refetches (lib/gradingCache.ts). Covers the immediate and the
  // trailing (coalesced) emit. The whole-quiz list does not refetch on session:live.
  invalidateSessionPart(sessionId, 'summary');
  io?.to(`staff:${sessionId}`).emit('session:live');
}

/**
 * "Something changed in this session" for staff screens, at most once per 500 ms per session
 * (first event at once, later ones in that window folded into one trailing event).
 */
export function broadcastLiveUpdate(sessionId: number) {
  if (!io) return;
  const win = liveWindows.get(sessionId);
  if (win) {
    win.dirty = true;
    return;
  }
  emitLive(sessionId);
  const open = () => {
    const timer = setTimeout(() => {
      const current = liveWindows.get(sessionId);
      if (current?.dirty) {
        emitLive(sessionId);
        current.dirty = false;
        current.timer = open();
      } else {
        liveWindows.delete(sessionId);
      }
    }, LIVE_WINDOW_MS);
    timer.unref();
    return timer;
  };
  liveWindows.set(sessionId, { timer: open(), dirty: false });
}

/**
 * An event for one participant only (S15 "Reopen submission"): it goes to the sockets in the session
 * room whose token is still that participant's, never to the room, so no one else learns of it.
 * Returns how many sockets got it; a participant who is offline catches up through the page's poll
 * and reconnect refresh.
 */
export function emitToParticipant(sessionId: number, participantId: number, event: string, payload: object): number {
  if (!io) return 0;
  let sent = 0;
  for (const socket of io.sockets.sockets.values()) {
    const grant = grants(socket).get(`session:${sessionId}`);
    if (!grant) continue;
    const who = authenticate(grant.token, 'participant');
    if (who.ok && who.role === 'participant' && who.participant.participantId === participantId && who.participant.sessionId === sessionId) {
      socket.emit(event, payload);
      sent += 1;
    }
  }
  return sent;
}

/**
 * Grading-relevant changes (submit, reopen, session end, grades, regrades, rule/key/AI checks) for the
 * grading panel (S12). Every caller has just committed the change, so the session's cached grading
 * data (lib/gradingCache.ts) is dropped first: the next read, including the writer's own, is fresh.
 */
export function broadcastGradingChanged(sessionId: number, payload: object) {
  invalidateSessionCache(sessionId);
  io?.to(`staff:${sessionId}`).emit('grading:changed', payload);
}
