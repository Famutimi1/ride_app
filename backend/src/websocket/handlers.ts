import type { Server, Socket } from 'socket.io';
import { saveDriverLocation, type DriverCoordinate } from '../modules/location/location.service';
import { SOCKET_EVENTS } from './events';

function validCoordinate(value: DriverCoordinate) {
  return value.driverId && Number.isFinite(value.latitude) && Number.isFinite(value.longitude);
}

export function registerSocketHandlers(io: Server, socket: Socket) {
  socket.on(SOCKET_EVENTS.JOIN_TRIP, (tripId: string) => {
    if (tripId) socket.join(`trip:${tripId}`);
  });

  socket.on(SOCKET_EVENTS.DRIVER_LOCATION_UPDATE, async (payload: DriverCoordinate) => {
    if (!validCoordinate(payload)) return socket.emit(SOCKET_EVENTS.LOCATION_ERROR, 'Invalid coordinates');
    try {
      await saveDriverLocation(payload);
      if (payload.tripId) io.to(`trip:${payload.tripId}`).emit(SOCKET_EVENTS.DRIVER_LOCATION, payload);
    } catch (error) {
      socket.emit(SOCKET_EVENTS.LOCATION_ERROR, error instanceof Error ? error.message : 'Location update failed');
    }
  });
}
