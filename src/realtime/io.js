import { Server } from 'socket.io';
import { clientOrigins } from '../config/env.js';

let io = null;

export function initIo(httpServer) {
  io = new Server(httpServer, { cors: { origin: clientOrigins } });
  return io;
}

export const getIo = () => io;
export const emitToUser = (userId, event, payload) => io?.to(`user:${userId}`).emit(event, payload);
export const emitToRoute = (routeId, event, payload) => io?.to(`route:${routeId}`).emit(event, payload);
export const emitToSession = (sessionId, event, payload) => io?.to(`session:${sessionId}`).emit(event, payload);
export const emitToRoom = (room, event, payload) => io?.to(room).emit(event, payload);
export const emitToAdmin = (event, payload) => io?.to('admin').emit(event, payload);
export const joinUserToRoom = (userId, room) => io?.in(`user:${userId}`).socketsJoin(room);
export const closeRoom = (room) => io?.in(room).socketsLeave(room);

export async function isUserOnline(userId) {
  if (!io) return false;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  return sockets.length > 0;
}
