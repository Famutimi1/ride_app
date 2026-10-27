import { createAdapter } from '@socket.io/redis-adapter';
import { ensureRedis } from '../shared/config/redis';
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { registerSocketHandlers } from './handlers';
import { verifyAccessToken } from '../modules/auth/jwt.service';
import { db } from '../shared/config/db';
import { registerNotificationServer } from './notifications';
import { authenticatedSessionUser } from '../modules/auth/auth.service';

// Native clients keep handshake auth; the website BFF supplies its HttpOnly session as Bearer.
function socketToken(socket:import('socket.io').Socket):string{
  const token=socket.handshake.auth?.token;
  if(typeof token==='string')return token;
  const header=socket.handshake.headers.authorization;
  if(typeof header==='string'&&header.startsWith('Bearer '))return header.slice(7);
  throw new Error('missing_token');
}

export async function attachWebsocket(server: HttpServer) {
  const connection = await ensureRedis();
  const pub = connection.duplicate({ lazyConnect: true });
  const sub = connection.duplicate({ lazyConnect: true });
  pub.on('error', () => console.error('[socket] Redis publisher unavailable'));
  sub.on('error', () => console.error('[socket] Redis subscriber unavailable'));
  try { await Promise.all([pub.connect(), sub.connect()]); }
  catch (error) { pub.disconnect(); sub.disconnect(); throw error; }
  const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 16*1024 });
  io.adapter(createAdapter(pub, sub, { key: 'rakky:socket.io', publishOnSpecificResponseChannel: true }));
  server.once('close', () => { pub.disconnect(); sub.disconnect(); });
  registerNotificationServer(io);
  io.use(async(socket,next)=>{try{const payload=verifyAccessToken(socketToken(socket));if(typeof payload.exp!=='number')throw new Error('missing_expiry');const user=await authenticatedSessionUser(payload);if(!user)throw new Error('inactive');socket.data.userId=user.id;socket.data.sessionId=payload.sessionId;socket.data.accessExpiresAt=Math.min(payload.exp,typeof payload.sessionExpiresAt==='number'?payload.sessionExpiresAt:Infinity)*1000;next();}catch{next(new Error('unauthorized'));}});
  io.on('connection', (socket) => {
    if(socket.data.sessionId)socket.join(`session:${socket.data.sessionId}`);
    const expire = setTimeout(() => socket.disconnect(true), Math.max(0, Math.min(2_147_483_647, Number(socket.data.accessExpiresAt) - Date.now())));
    expire.unref();
    let recheck: ReturnType<typeof setTimeout> | undefined;
    const checkAccount = async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const payload=verifyAccessToken(socketToken(socket));
        const active = await Promise.race([
          authenticatedSessionUser(payload),
          new Promise<never>((_done,reject)=>{timeout=setTimeout(()=>reject(new Error('socket_auth_timeout')),2000);}),
        ]);
        if (!active) throw new Error('inactive');
      } catch { socket.disconnect(true); }
      finally { if(timeout)clearTimeout(timeout); }
      if(socket.connected){recheck=setTimeout(()=>void checkAccount(),2500);recheck.unref();}
    };
    recheck=setTimeout(()=>void checkAccount(),2500);
    recheck.unref();
    socket.once('disconnect',()=>{clearTimeout(expire);if(recheck)clearTimeout(recheck);});
    // Recheck expiry and account revocation before processing every packet.
    socket.use(async (_packet, next) => {
      try {
        const payload=verifyAccessToken(socketToken(socket));
        const active=await authenticatedSessionUser(payload);
        if(!active)throw new Error('inactive');
        next();
      } catch { next(new Error('unauthorized')); socket.disconnect(true); }
    });
    registerSocketHandlers(io, socket);
  });
  return io;
}
