import type { Trip } from '@/services/tripService';

export interface RepeatRide {
  trip: Trip;
  count: number;
  completedCount: number;
}

function locationKey(latitude: number, longitude: number): string {
  // Nearby GPS fixes for the same address should count as one route.
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

export function selectRepeatRides(trips: Trip[], limit = 2): RepeatRide[] {
  const routes = new Map<string, RepeatRide>();
  for (const trip of trips) {
    if (!['completed', 'no_drivers_found', 'cancelled'].includes(trip.status) || trip.service_type !== 'ride') continue;
    if (![trip.pickup_lat, trip.pickup_lng, trip.dropoff_lat, trip.dropoff_lng].every(Number.isFinite)) continue;
    const key = `${locationKey(trip.pickup_lat, trip.pickup_lng)}:${locationKey(trip.dropoff_lat, trip.dropoff_lng)}`;
    const existing = routes.get(key);
    if (existing) {
      existing.count += 1;
      if (trip.status === 'completed') existing.completedCount += 1;
      if (Date.parse(trip.completed_at ?? trip.requested_at) > Date.parse(existing.trip.completed_at ?? existing.trip.requested_at)) existing.trip = trip;
    } else routes.set(key, { trip, count: 1, completedCount: trip.status === 'completed' ? 1 : 0 });
  }
  return [...routes.values()]
    .sort((a, b) => Number(b.completedCount > 0) - Number(a.completedCount > 0) || b.count - a.count || Date.parse(b.trip.completed_at ?? b.trip.requested_at) - Date.parse(a.trip.completed_at ?? a.trip.requested_at))
    .slice(0, limit);
}
