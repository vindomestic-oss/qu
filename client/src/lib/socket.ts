import { io, Socket } from 'socket.io-client';
import { getToken } from '../api/client';
import { getParticipantToken } from '../api/participantClient';
import { getStaffToken } from '../api/graderClient';

export type RoomKind = 'session' | 'staff';

let socket: Socket | null = null;
// How many components currently need each room ("session:12", "staff:12").
const roomRefs = new Map<string, number>();

function roomKey(kind: RoomKind, id: number): string {
  return `${kind}:${id}`;
}

/** Fired on window when the server refuses a staff room (e.g. a revoked grader link); detail = sessionId. */
export const STAFF_JOIN_REFUSED_EVENT = 'quiz:staff-join-refused';

// The token is read at every (re)join, so a fresh login or a rejoin is picked up. Admins use the
// session room only for session:update; staff data (session:live) arrives in the staff room. The
// staff room takes the admin token, or the grader token of that session (grading panel, wish 8).
function emitJoin(kind: RoomKind, id: number): void {
  const token = kind === 'staff' ? (getStaffToken(id)?.token ?? null) : (getParticipantToken() ?? getToken());
  if (!token || !socket) return;
  socket.emit(`${kind}:join`, { sessionId: id, token }, (r?: { ok: boolean; error?: string }) => {
    if (r?.ok) return;
    console.warn(`${kind}:join refused`, r?.error);
    if (kind === 'staff') window.dispatchEvent(new CustomEvent(STAFF_JOIN_REFUSED_EVENT, { detail: id }));
  });
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io({ path: '/socket.io' });
    // A reconnect starts with no rooms on the server: join every room that is still in use.
    socket.on('connect', () => {
      for (const [key, count] of roomRefs) {
        if (count <= 0) continue;
        const [kind, id] = key.split(':');
        emitJoin(kind as RoomKind, Number(id));
      }
    });
  }
  return socket;
}

/** Joins a room for one user of it; the server room is left when the last user calls leaveRoom. */
export function joinRoom(kind: RoomKind, id: number): void {
  const s = getSocket();
  const key = roomKey(kind, id);
  const count = (roomRefs.get(key) ?? 0) + 1;
  roomRefs.set(key, count);
  if (count === 1 && s.connected) emitJoin(kind, id);
}

export function leaveRoom(kind: RoomKind, id: number): void {
  const key = roomKey(kind, id);
  const count = (roomRefs.get(key) ?? 0) - 1;
  if (count > 0) {
    roomRefs.set(key, count);
    return;
  }
  roomRefs.delete(key);
  socket?.emit(`${kind}:leave`, { sessionId: id });
}
