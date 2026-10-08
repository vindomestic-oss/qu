import { io, Socket } from 'socket.io-client';
import { getToken } from '../api/client';
import { getParticipantToken } from '../api/participantClient';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({ path: '/socket.io' });
  }
  return socket;
}

export function joinSessionRoom(sessionId: number, as: 'admin' | 'participant'): void {
  const token = as === 'admin' ? getToken() : getParticipantToken();
  if (!token) return;
  getSocket().emit('session:join', { sessionId, token });
}
