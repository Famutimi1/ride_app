import type { Server } from 'socket.io';
import { SOCKET_EVENTS } from '../../websocket/events';
import type { TripRow } from './trip.types';

let socketServer: Server | null = null;

export function registerTripSocketServer(io: Server) {
  socketServer = io;
}

export function emitDriverOffer(driverId: string, payload: Record<string, unknown>) {
  socketServer?.to(`driver:${driverId}`).emit(SOCKET_EVENTS.TRIP_OFFER, payload);
}

export function emitOfferCancelled(driverId: string, tripId: string) {
  socketServer?.to(`driver:${driverId}`).emit(SOCKET_EVENTS.TRIP_OFFER_CANCELLED, { tripId });
}

export function emitTripStatus(trip: TripRow, driver?: Record<string, unknown>) {
  socketServer?.to(`trip:${trip.id}`).emit(SOCKET_EVENTS.TRIP_STATUS, {
    tripId: trip.id,
    status: trip.status,
    at: Date.now(),
    ...(driver ? { driver } : {}),
  });
}
