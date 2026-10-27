import type { Server } from 'socket.io';
import { SOCKET_EVENTS } from './events';
import type { NotificationRecord } from '../modules/notifications/notifications.types';
import type { CommunicationReceipts, TripMessage } from '../modules/communication/communication.types';

let server:Server|null=null;
export function registerNotificationServer(io:Server) {server=io;}
export function emitServiceSettingsChanged(userId:string) {server?.to(`driver:${userId}`).emit(SOCKET_EVENTS.DRIVER_SERVICE_SETTINGS,{at:Date.now()});}
export function emitWalletUpdated(userId:string) {server?.to(`user:${userId}`).emit(SOCKET_EVENTS.WALLET_UPDATED,{at:Date.now()});}
export function emitTripMessage(message:{tripId:string}){server?.to(`trip:${message.tripId}`).emit(SOCKET_EVENTS.TRIP_MESSAGE,message);}
export function emitCommunicationMessage(message:TripMessage,participants:string[]){
  if(!server)throw new Error('communication_socket_unavailable');
  // User rooms also reach participants' other devices. Avoid a stale trip room
  // retaining an earlier participant after an assignment/account change.
  server.to(participants.map(id=>`user:${id}`)).emit(SOCKET_EVENTS.TRIP_MESSAGE,message);
}
export function emitCommunicationReceipt(receipts:CommunicationReceipts,participants:string[]){
  if(!server)throw new Error('communication_socket_unavailable');
  server.to(participants.map(id=>`user:${id}`)).emit(SOCKET_EVENTS.CHAT_RECEIPT,receipts);
}
export function emitUserNotification(userId:string,notification:NotificationRecord){server?.to(`user:${userId}`).emit(SOCKET_EVENTS.NOTIFICATION,notification);}
export function disconnectSessionSockets(sessionId:string) {server?.in(`session:${sessionId}`).disconnectSockets(true);}
export function disconnectAccountSockets(userId:string) {server?.in(`user:${userId}`).disconnectSockets(true);}
export function emitCallState(call:ReturnType<typeof import('../modules/communication/call.types').presentCall>,participants:string[]) {
  if(!server)throw new Error('call_socket_unavailable');
  server.to(participants.map(id=>`user:${id}`)).emit(SOCKET_EVENTS.CALL_STATE,call);
}
