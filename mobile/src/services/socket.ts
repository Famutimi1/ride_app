import { io, type Socket } from 'socket.io-client';
import { API_BASE_URL } from './api';
import type { DriverMapLocation } from '@/store/mapStore';

export const SOCKET_EVENTS = {
  JOIN_TRIP: 'trip:join',
  DRIVER_LOCATION_UPDATE: 'driver:location:update',
  DRIVER_LOCATION: 'driver:location',
} as const;

let socket: Socket | null = null;

export function getSocket(token?: string) {
  if (!socket) socket = io(API_BASE_URL, { transports: ['websocket'], autoConnect: true, auth: { token } });
  return socket;
}

export function subscribeToTrip(tripId: string, onLocation: (location: DriverMapLocation) => void) {
  const activeSocket = getSocket();
  activeSocket.emit(SOCKET_EVENTS.JOIN_TRIP, tripId);
  activeSocket.on(SOCKET_EVENTS.DRIVER_LOCATION, onLocation);
  return () => activeSocket.off(SOCKET_EVENTS.DRIVER_LOCATION, onLocation);
}
