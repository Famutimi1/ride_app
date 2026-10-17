import { io, type Socket } from 'socket.io-client';
import { API_BASE_URL } from './api';
import type { DriverMapLocation } from '@/store/mapStore';
import { tokenStore } from '@/lib/secureTokenStore';
import { isSessionRejected, refreshAccessToken } from '@/lib/apiClient';

export const SOCKET_EVENTS = {
  JOIN_TRIP: 'trip:join',
  DRIVER_LOCATION_UPDATE: 'driver:location:update',
  DRIVER_LOCATION: 'driver:location',
  DRIVER_OFFLINE: 'driver:offline',
  DRIVER_SERVICE_SETTINGS: 'driver:service-settings',
  TRIP_MESSAGE_SEND: 'trip:message:send',
  TRIP_MESSAGE: 'trip:message',
  TRIP_MESSAGE_ERROR: 'trip:message:error',
  TRIP_OFFER: 'trip:offer',
  TRIP_OFFER_CANCELLED: 'trip:offer_cancelled',
  TRIP_STATUS: 'trip:status',
  WALLET_UPDATED: 'wallet:updated',
  NOTIFICATION: 'notification:new',
} as const;

export interface TripMessage {
  id: string;
  tripId: string;
  senderId: string;
  senderRole: 'rider' | 'driver';
  text: string;
  sentAt: number;
}

let socket: Socket | null = null;
let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
let recoveryAttempts = 0;
let recoveringSocket: Socket | null = null;

async function recoverAuthentication(activeSocket: Socket) {
  if (recoveringSocket === activeSocket || socket !== activeSocket || recoveryAttempts >= 3) return;
  recoveringSocket = activeSocket;
  recoveryAttempts += 1;
  try {
    await refreshAccessToken();
    if (socket === activeSocket) activeSocket.connect();
  } catch (error) {
    if (socket === activeSocket && !isSessionRejected(error) && recoveryAttempts < 3) {
      recoveryTimer = setTimeout(() => { recoveryTimer = null; void recoverAuthentication(activeSocket); }, recoveryAttempts * 2000);
    }
  } finally { if (recoveringSocket === activeSocket) recoveringSocket = null; }
}

export function getSocket() {
  if (!socket) {
    const activeSocket = io(API_BASE_URL, { transports: ['websocket'], autoConnect: true, auth: async (callback) => callback({ token: await tokenStore.getAccessToken() }) });
    socket = activeSocket;
    activeSocket.on('connect', () => { recoveryAttempts = 0; });
    activeSocket.on('connect_error', (error: Error) => {
      if (error.message === 'unauthorized') void recoverAuthentication(activeSocket);
    });
    activeSocket.on('disconnect', (reason: string) => {
      if (reason === 'io server disconnect') void recoverAuthentication(activeSocket);
    });
  }
  return socket;
}

export function resetSocket() {
  if (recoveryTimer) clearTimeout(recoveryTimer);
  recoveryTimer = null;
  recoveryAttempts = 0;
  const previous = socket;
  socket = null;
  previous?.removeAllListeners();
  previous?.disconnect();
}

export function reconnectSocket() {
  const activeSocket = getSocket();
  if (!activeSocket.connected) { recoveryAttempts = 0; activeSocket.connect(); }
}

export function subscribeToTrip(tripId: string, onLocation: (location: DriverMapLocation) => void) {
  const activeSocket = getSocket();
  const join = () => activeSocket.emit(SOCKET_EVENTS.JOIN_TRIP, tripId);
  join();
  activeSocket.on('connect', join);
  activeSocket.on(SOCKET_EVENTS.DRIVER_LOCATION, onLocation);
  return () => {
    activeSocket.off(SOCKET_EVENTS.DRIVER_LOCATION, onLocation);
    activeSocket.off('connect', join);
  };
}

export function subscribeToTripLifecycle(handlers:{onOffer:(offer:import('./tripService').TripOffer)=>void;onOfferCancelled:(value:{tripId:string})=>void;onStatus:(value:{tripId:string;status:import('./tripService').TripStatus;driverId?:string|null;driver?:Record<string,unknown>})=>void;onReconnect:()=>void}){
  const activeSocket=getSocket();
  activeSocket.on(SOCKET_EVENTS.TRIP_OFFER,handlers.onOffer);activeSocket.on(SOCKET_EVENTS.TRIP_OFFER_CANCELLED,handlers.onOfferCancelled);activeSocket.on(SOCKET_EVENTS.TRIP_STATUS,handlers.onStatus);activeSocket.on('connect',handlers.onReconnect);
  return()=>{activeSocket.off(SOCKET_EVENTS.TRIP_OFFER,handlers.onOffer);activeSocket.off(SOCKET_EVENTS.TRIP_OFFER_CANCELLED,handlers.onOfferCancelled);activeSocket.off(SOCKET_EVENTS.TRIP_STATUS,handlers.onStatus);activeSocket.off('connect',handlers.onReconnect);};
}

export function subscribeToNotifications(onNotification:(notification:import('./notificationService').AppNotification)=>void){const activeSocket=getSocket();activeSocket.on(SOCKET_EVENTS.NOTIFICATION,onNotification);return()=>activeSocket.off(SOCKET_EVENTS.NOTIFICATION,onNotification);}

export function sendTripMessage(message: TripMessage) {
  const activeSocket = getSocket();
  activeSocket.emit(SOCKET_EVENTS.JOIN_TRIP, message.tripId);
  activeSocket.emit(SOCKET_EVENTS.TRIP_MESSAGE_SEND, message);
}

export function subscribeToTripMessages(tripId: string, onMessage: (message: TripMessage) => void) {
  const activeSocket = getSocket();
  const join = () => activeSocket.emit(SOCKET_EVENTS.JOIN_TRIP, tripId);
  join();
  activeSocket.on('connect', join);
  activeSocket.on(SOCKET_EVENTS.TRIP_MESSAGE, onMessage);
  return () => {
    activeSocket.off(SOCKET_EVENTS.TRIP_MESSAGE, onMessage);
    activeSocket.off('connect', join);
  };
}
