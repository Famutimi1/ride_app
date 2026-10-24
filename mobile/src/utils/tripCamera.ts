import type { TripStatus } from '@/services/tripService';
import type { MapCoordinate, MapRegion } from '@/store/mapStore';

export const ACTIVE_TRIP_ZOOM = 19;

/** Follow the vehicle at street level only while the trip is under way. */
export function activeTripRegion(status: TripStatus | undefined, position: MapCoordinate | null): MapRegion | undefined {
  if ((status !== 'in_progress' && status !== 'returning') || !position) return undefined;
  if (!Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)
    || Math.abs(position.latitude) > 90 || Math.abs(position.longitude) > 180) return undefined;

  const span = 360 / 2 ** ACTIVE_TRIP_ZOOM;
  return { latitude: position.latitude, longitude: position.longitude, latitudeDelta: span, longitudeDelta: span };
}
