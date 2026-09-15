import { env } from '../../config/env';

export interface Coordinate {
  latitude: number;
  longitude: number;
}

interface GoogleErrorBody {
  error?: { message?: string };
  error_message?: string;
  status?: string;
}

function requireKey(): string {
  if (!env.GOOGLE_MAPS_API_KEY) {
    throw new Error('Google Maps server key is not configured');
  }
  return env.GOOGLE_MAPS_API_KEY;
}

async function googleJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) });
  const body = (await response.json()) as T & GoogleErrorBody;
  if (!response.ok || body.status === 'REQUEST_DENIED' || body.status === 'INVALID_REQUEST') {
    throw new Error(body.error?.message ?? body.error_message ?? 'Google Maps request failed');
  }
  return body;
}

export async function autocompletePlaces(input: string, location?: Coordinate) {
  const body: Record<string, unknown> = {
    input,
    includedRegionCodes: ['ng'],
    languageCode: 'en',
  };
  if (location) {
    body.locationBias = {
      circle: { center: { latitude: location.latitude, longitude: location.longitude }, radius: 50_000 },
    };
  }

  const result = await googleJson<{
    suggestions?: Array<{ placePrediction?: { placeId: string; text?: { text?: string }; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } }>;
  }>('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': requireKey(),
      'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat',
    },
    body: JSON.stringify(body),
  });

  return (result.suggestions ?? []).flatMap(({ placePrediction }) => placePrediction ? [{
    placeId: placePrediction.placeId,
    address: placePrediction.text?.text ?? '',
    primaryText: placePrediction.structuredFormat?.mainText?.text ?? placePrediction.text?.text ?? '',
    secondaryText: placePrediction.structuredFormat?.secondaryText?.text ?? '',
  }] : []);
}

export async function getPlaceDetails(placeId: string) {
  const result = await googleJson<{ id: string; formattedAddress: string; location: { latitude: number; longitude: number }; addressComponents?: Array<{ longText: string; types: string[] }> }>(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    { headers: { 'X-Goog-Api-Key': requireKey(), 'X-Goog-FieldMask': 'id,formattedAddress,location,addressComponents' } },
  );
  return {
    placeId: result.id,
    address: result.formattedAddress,
    latitude: result.location.latitude,
    longitude: result.location.longitude,
    countryCode: result.addressComponents?.find((part) => part.types.includes('country'))?.longText,
  };
}

export async function reverseGeocode(location: Coordinate) {
  const params = new URLSearchParams({ latlng: `${location.latitude},${location.longitude}`, key: requireKey() });
  const result = await googleJson<{ results?: Array<{ formatted_address: string; place_id: string; address_components: Array<{ short_name: string; types: string[] }> }>; status: string }>(
    `https://maps.googleapis.com/maps/api/geocode/json?${params}`,
  );
  const first = result.results?.[0];
  if (!first) return null;
  return {
    address: first.formatted_address,
    placeId: first.place_id,
    countryCode: first.address_components.find((part) => part.types.includes('country'))?.short_name,
    ...location,
  };
}

export async function getRoute(origin: Coordinate, destination: Coordinate) {
  const params = new URLSearchParams({
    origin: `${origin.latitude},${origin.longitude}`,
    destination: `${destination.latitude},${destination.longitude}`,
    mode: 'driving',
    key: requireKey(),
  });
  const result = await googleJson<{ routes?: Array<{ overview_polyline: { points: string }; legs: Array<{ distance: { value: number }; duration: { value: number } }> }>; status: string }>(
    `https://maps.googleapis.com/maps/api/directions/json?${params}`,
  );
  const route = result.routes?.[0];
  if (!route) throw new Error('No driving route was found');
  return {
    encodedPolyline: route.overview_polyline.points,
    distanceKm: route.legs.reduce((sum, leg) => sum + leg.distance.value, 0) / 1000,
    durationMin: route.legs.reduce((sum, leg) => sum + leg.duration.value, 0) / 60,
  };
}

export async function getEstimate(origin: Coordinate, destination: Coordinate) {
  const params = new URLSearchParams({
    origins: `${origin.latitude},${origin.longitude}`,
    destinations: `${destination.latitude},${destination.longitude}`,
    mode: 'driving',
    key: requireKey(),
  });
  const result = await googleJson<{ rows?: Array<{ elements: Array<{ status: string; distance?: { value: number }; duration?: { value: number } }> }>; status: string }>(
    `https://maps.googleapis.com/maps/api/distancematrix/json?${params}`,
  );
  const element = result.rows?.[0]?.elements[0];
  if (!element || element.status !== 'OK' || !element.distance || !element.duration) {
    throw new Error('A fare estimate is not available for this route');
  }
  const distanceKm = element.distance.value / 1000;
  const durationMin = element.duration.value / 60;
  const estimatedFare = Math.round(
    env.FARE_BASE_NGN + distanceKm * env.FARE_PER_KM_NGN + durationMin * env.FARE_PER_MINUTE_NGN,
  );
  return { distanceKm, durationMin, estimatedFare, currency: 'NGN' as const };
}
