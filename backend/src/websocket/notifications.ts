import type { Server } from 'socket.io';
import { SOCKET_EVENTS } from './events';
import type { NotificationRecord } from '../modules/notifications/notifications.types';

let server:Server|null=null;
export function registerNotificationServer(io:Server) {server=io;}
export function emitServiceSettingsChanged(userId:string) {server?.to(`driver:${userId}`).emit(SOCKET_EVENTS.DRIVER_SERVICE_SETTINGS,{at:Date.now()});}
export function emitWalletUpdated(userId:string) {server?.to(`user:${userId}`).emit(SOCKET_EVENTS.WALLET_UPDATED,{at:Date.now()});}
export function emitTripMessage(message:{tripId:string}){server?.to(`trip:${message.tripId}`).emit(SOCKET_EVENTS.TRIP_MESSAGE,message);}
export function emitUserNotification(userId:string,notification:NotificationRecord){server?.to(`user:${userId}`).emit(SOCKET_EVENTS.NOTIFICATION,notification);}
export function disconnectSessionSockets(sessionId:string) {server?.in(`session:${sessionId}`).disconnectSockets(true);}
export function disconnectAccountSockets(userId:string) {server?.in(`user:${userId}`).disconnectSockets(true);}
