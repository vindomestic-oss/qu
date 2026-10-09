import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { authenticate } from './middleware/jwt';

let io: Server | undefined;

export function initSocket(server: HttpServer): Server {
  io = new Server(server, { cors: { origin: '*' } });

  // The connection itself grants nothing; every room join is authorised.
  io.on('connection', (socket) => {
    socket.on('session:join', (payload: unknown, ack?: unknown) => {
      const reply = typeof ack === 'function' ? (ack as (r: object) => void) : () => {};
      const p = (typeof payload === 'object' && payload !== null ? payload : {}) as {
        sessionId?: unknown;
        token?: unknown;
      };
      if (!Number.isInteger(p.sessionId) || typeof p.token !== 'string') {
        return reply({ ok: false, error: 'TOKEN_REQUIRED' }); // also the old bare-number form
      }
      const asAdmin = authenticate(p.token, 'admin');
      const asParticipant = asAdmin.ok ? null : authenticate(p.token, 'participant');
      const allowed =
        asAdmin.ok ||
        (asParticipant?.ok === true &&
          asParticipant.role === 'participant' &&
          asParticipant.participant.sessionId === p.sessionId);
      if (!allowed) return reply({ ok: false, error: 'FORBIDDEN' });
      socket.join(`session:${p.sessionId}`);
      reply({ ok: true });
    });
  });

  return io;
}

export function getIo(): Server {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}

export function broadcastSessionUpdate(sessionId: number, payload: unknown) {
  getIo().to(`session:${sessionId}`).emit('session:update', payload);
}

export function broadcastLiveUpdate(sessionId: number) {
  getIo().to(`session:${sessionId}`).emit('session:live');
}
