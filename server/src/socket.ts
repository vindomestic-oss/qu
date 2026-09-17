import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';

let io: Server | undefined;

export function initSocket(server: HttpServer): Server {
  io = new Server(server, { cors: { origin: '*' } });

  io.on('connection', (socket) => {
    socket.on('session:join', (sessionId: number) => {
      socket.join(`session:${sessionId}`);
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
