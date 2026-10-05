import type { Server } from 'socket.io';
import { SOCKET_EVENTS } from './events';

let server:Server|null=null;
export function registerNotificationServer(io:Server) {server=io;}
export function emitWalletUpdated(userId:string) {server?.to(`user:${userId}`).emit(SOCKET_EVENTS.WALLET_UPDATED,{at:Date.now()});}
