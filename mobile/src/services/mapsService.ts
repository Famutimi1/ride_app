import { apiRequest } from './api';
import { decodePolyline } from '@/utils/polyline';
import type { MapCoordinate, MapLocation } from '@/store/mapStore';

export interface PlacePrediction {
  placeId: string;
  address: string;
  primaryText: string;
  secondaryText: string;
}

export interface TripEstimate {
  distanceKm: number;
  durationMin: number;
  estimatedFare: number;
  currency: 'NGN';
}

const estimateCache = new Map<string, { expiresAt: number; value: TripEstimate }>();

export async function autocompletePlaces(input: string, location?: MapCoordinate) {
  const result = await apiRequest<{ predictions: PlacePrediction[] }>('/places/autocomplete', {
    method: 'POST', body: JSON.stringify({ input, location }),
  });
  return result.predictions;
}

export function getPlaceDetails(placeId: string) {
  return apiRequest<MapLocation>('/places/details', { method: 'POST', body: JSON.stringify({ placeId }) });
}

export async function reverseGeocode(location: MapCoordinate) {
  const result = await apiRequest<{ location: MapLocation | null }>('/geocode/reverse', {
    method: 'POST', body: JSON.stringify(location),
  });
  return result.location;
}

export async function getTripRoute(pickup: MapCoordinate, dropoff: MapCoordinate) {
  const result = await apiRequest<{ encodedPolyline: string; distanceKm: number; durationMin: number }>('/trips/route', {
    method: 'POST', body: JSON.stringify({ pickup, dropoff }),
  });
  return { ...result, coordinates: decodePolyline(result.encodedPolyline) };
}

export async function getTripEstimate(pickup: MapCoordinate, dropoff: MapCoordinate) {
  const key = `${pickup.latitude},${pickup.longitude}:${dropoff.latitude},${dropoff.longitude}`;
  const cached = estimateCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await apiRequest<TripEstimate>('/trips/estimate', {
    method: 'POST', body: JSON.stringify({ pickup, dropoff }),
  });
  estimateCache.set(key, { value, expiresAt: Date.now() + 60_000 });
  return value;
}

export async function getNearbyDrivers(location: MapCoordinate, radiusKm = 5) {
  const query = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), radiusKm: String(radiusKm) });
  const result = await apiRequest<{ drivers: { driverId: string; latitude: number; longitude: number; distanceKm: number }[] }>(`/location/nearby?${query}`);
  return result.drivers;
}
