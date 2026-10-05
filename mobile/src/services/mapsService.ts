import { apiClient } from '@/lib/apiClient';
import { decodePolyline } from '@/utils/polyline';
import type { MapCoordinate, MapLocation } from '@/store/mapStore';

export interface PlacePrediction {
  placeId: string;
  address: string;
  primaryText: string;
  secondaryText: string;
}

export interface TripEstimate {
  fareKobo: number;
  distanceKm: number;
  durationMin: number;
  estimatedFare: number;
  currency: 'NGN';
}

const estimateCache = new Map<string, { expiresAt: number; value: TripEstimate }>();

export async function autocompletePlaces(input: string, location?: MapCoordinate) {
  const { data: result } = await apiClient.post<{ predictions: PlacePrediction[] }>('/places/autocomplete', { input, location });
  return result.predictions;
}

export function getPlaceDetails(placeId: string) {
  return apiClient.post<MapLocation>('/places/details', { placeId }).then((response) => response.data);
}

export async function reverseGeocode(location: MapCoordinate) {
  const { data: result } = await apiClient.post<{ location: MapLocation | null }>('/geocode/reverse', location);
  return result.location;
}

export async function getTripRoute(pickup: MapCoordinate, dropoff: MapCoordinate) {
  const {data:result}=await apiClient.post<{encodedPolyline:string;distanceKm:number;durationMin:number}>('/trips/route',{pickup,dropoff});
  return { ...result, coordinates: decodePolyline(result.encodedPolyline) };
}

export async function getTripEstimate(pickup: MapLocation, dropoff: MapLocation) {
  const key = `${pickup.latitude},${pickup.longitude}:${dropoff.latitude},${dropoff.longitude}`;
  const cached = estimateCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const {data:value}=await apiClient.post<TripEstimate>('/trips/estimate',{pickup,dropoff});
  estimateCache.set(key, { value, expiresAt: Date.now() + 60_000 });
  return value;
}

export async function getNearbyDrivers(location: MapCoordinate, radiusKm = 5) {
  const query = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), radiusKm: String(radiusKm) });
  const { data: result } = await apiClient.get<{ drivers: { driverId: string; latitude: number; longitude: number; distanceKm: number }[] }>(`/location/nearby?${query}`);
  return result.drivers;
}
