import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { registerSocketHandlers } from './handlers';
import { verifyAccessToken } from '../modules/auth/jwt.service';
import { db } from '../shared/config/db';
import { registerNotificationServer } from './notifications';

export function attachWebsocket(server: HttpServer) {
  const io = new Server(server, { cors: { origin: '*' } });
  registerNotificationServer(io);
  io.use(async(socket,next)=>{try{const token=socket.handshake.auth?.token;if(typeof token!=='string')throw new Error('missing');const payload=verifyAccessToken(token);const {rows}=await db.query('SELECT id FROM users WHERE id=$1 AND is_active=true',[payload.sub]);if(!rows[0])throw new Error('inactive');socket.data.userId=rows[0].id;next();}catch{next(new Error('unauthorized'));}});
  io.on('connection', (socket) => registerSocketHandlers(io, socket));
  return io;
}
