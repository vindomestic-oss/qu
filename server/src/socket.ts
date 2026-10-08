import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

const envSecret = process.env.JWT_SECRET;
if (!envSecret) {
  throw new Error('JWT_SECRET env var is required');
}
const JWT_SECRET: string = envSecret;

let io: Server | undefined;

function canJoinSession(token: unknown, sessionId: number): boolean {
  if (typeof token !== 'string') return false;
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return false;
  }
  if (typeof decoded !== 'object' || decoded === null) return false;
  const { role, sessionId: tokenSessionId } = decoded as { role?: string; sessionId?: number };
  if (role === 'admin') return true;
  return role === 'participant' && tokenSessionId === sessionId;
}

export function initSocket(server: HttpServer): Server {
  io = new Server(server, { cors: { origin: '*' } });

  io.on('connection', (socket) => {
    socket.on('session:join', (payload: unknown) => {
      const { sessionId, token } = (typeof payload === 'object' && payload !== null ? payload : {}) as {
        sessionId?: unknown;
        token?: unknown;
      };
      if (typeof sessionId !== 'number' || !canJoinSession(token, sessionId)) return;
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
