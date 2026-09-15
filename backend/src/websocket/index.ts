import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { registerSocketHandlers } from './handlers';

export function attachWebsocket(server: HttpServer) {
  const io = new Server(server, { cors: { origin: '*' } });
  io.on('connection', (socket) => registerSocketHandlers(io, socket));
  return io;
}
