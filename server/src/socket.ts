import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { authenticate } from './middleware/jwt';
import { db } from './db';

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
 * the row without its join code.
 */
export function broadcastSessionUpdate(sessionId: number, payload: unknown) {
  if (!io) return;
  io.to(`session:${sessionId}`).to(`staff:${sessionId}`).except(`graders:${sessionId}`).emit('session:update', payload);
  const forGraders =
    typeof payload === 'object' && payload !== null
      ? Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'join_code'))
      : payload;
  io.to(`graders:${sessionId}`).emit('session:update', forGraders);
}

const LIVE_WINDOW_MS = 500;
const liveWindows = new Map<number, { timer: NodeJS.Timeout; dirty: boolean }>();

function emitLive(sessionId: number) {
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

/** Grading-relevant changes (submit, session end, grades) for the grading panel (S12). */
export function broadcastGradingChanged(sessionId: number, payload: object) {
  io?.to(`staff:${sessionId}`).emit('grading:changed', payload);
}
