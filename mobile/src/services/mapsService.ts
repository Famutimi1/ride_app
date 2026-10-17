import { apiClient } from '@/lib/apiClient';
import { anchorPolyline, decodePolyline } from '@/utils/polyline';
import type { MapCoordinate, MapLocation } from '@/store/mapStore';
import { estimateTrip } from './tripService';
export type { TripEstimate } from './tripService';

export interface PlacePrediction {
  placeId: string;
  address: string;
  primaryText: string;
  secondaryText: string;
}

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
  return { ...result, coordinates: anchorPolyline(decodePolyline(result.encodedPolyline), pickup, dropoff) };
}

export async function getTripEstimate(pickup: MapLocation, dropoff: MapLocation) {
  // Quotes belong to the current account and expire at the server's configured time.
  // Route calculation remains cached on the backend; accepted quotes are never cached here.
  return estimateTrip(pickup, dropoff);
}

export async function getNearbyDrivers(location: MapCoordinate, radiusKm = 5, serviceType:'ride'|'courier'='ride') {
  const query = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), radiusKm: String(radiusKm), serviceType });
  const { data: result } = await apiClient.get<{ drivers: { driverId: string; latitude: number; longitude: number; distanceKm: number }[] }>(`/location/nearby?${query}`);
  return result.drivers;
}
