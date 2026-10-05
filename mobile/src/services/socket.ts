import { io, type Socket } from 'socket.io-client';
import { API_BASE_URL } from './api';
import type { DriverMapLocation } from '@/store/mapStore';
import { tokenStore } from '@/lib/secureTokenStore';

export const SOCKET_EVENTS = {
  JOIN_TRIP: 'trip:join',
  DRIVER_LOCATION_UPDATE: 'driver:location:update',
  DRIVER_LOCATION: 'driver:location',
  DRIVER_OFFLINE: 'driver:offline',
  TRIP_MESSAGE_SEND: 'trip:message:send',
  TRIP_MESSAGE: 'trip:message',
  TRIP_MESSAGE_ERROR: 'trip:message:error',
  TRIP_OFFER: 'trip:offer',
  TRIP_OFFER_CANCELLED: 'trip:offer_cancelled',
  TRIP_STATUS: 'trip:status',
  WALLET_UPDATED: 'wallet:updated',
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

export function getSocket() {
  if (!socket) socket = io(API_BASE_URL, { transports: ['websocket'], autoConnect: true, auth: async (callback) => callback({ token: await tokenStore.getAccessToken() }) });
  return socket;
}

export function resetSocket() {
  socket?.disconnect();
  socket = null;
}

export function subscribeToTrip(tripId: string, onLocation: (location: DriverMapLocation) => void) {
  const activeSocket = getSocket();
  activeSocket.emit(SOCKET_EVENTS.JOIN_TRIP, tripId);
  activeSocket.on(SOCKET_EVENTS.DRIVER_LOCATION, onLocation);
  return () => {
    activeSocket.off(SOCKET_EVENTS.DRIVER_LOCATION, onLocation);
  };
}

export function subscribeToTripLifecycle(handlers:{onOffer:(offer:import('./tripService').TripOffer)=>void;onOfferCancelled:(value:{tripId:string})=>void;onStatus:(value:{tripId:string;status:import('./tripService').TripStatus;driver?:Record<string,unknown>})=>void;onReconnect:()=>void}){
  const activeSocket=getSocket();
  activeSocket.on(SOCKET_EVENTS.TRIP_OFFER,handlers.onOffer);activeSocket.on(SOCKET_EVENTS.TRIP_OFFER_CANCELLED,handlers.onOfferCancelled);activeSocket.on(SOCKET_EVENTS.TRIP_STATUS,handlers.onStatus);activeSocket.on('connect',handlers.onReconnect);
  return()=>{activeSocket.off(SOCKET_EVENTS.TRIP_OFFER,handlers.onOffer);activeSocket.off(SOCKET_EVENTS.TRIP_OFFER_CANCELLED,handlers.onOfferCancelled);activeSocket.off(SOCKET_EVENTS.TRIP_STATUS,handlers.onStatus);activeSocket.off('connect',handlers.onReconnect);};
}

export function sendTripMessage(message: TripMessage) {
  const activeSocket = getSocket();
  activeSocket.emit(SOCKET_EVENTS.JOIN_TRIP, message.tripId);
  activeSocket.emit(SOCKET_EVENTS.TRIP_MESSAGE_SEND, message);
}

export function subscribeToTripMessages(tripId: string, onMessage: (message: TripMessage) => void) {
  const activeSocket = getSocket();
  activeSocket.emit(SOCKET_EVENTS.JOIN_TRIP, tripId);
  activeSocket.on(SOCKET_EVENTS.TRIP_MESSAGE, onMessage);
  return () => {
    activeSocket.off(SOCKET_EVENTS.TRIP_MESSAGE, onMessage);
  };
}
