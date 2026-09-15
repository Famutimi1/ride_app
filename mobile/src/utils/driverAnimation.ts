import type { MapCoordinate } from '@/store/mapStore';

export function bearingBetween(from: MapCoordinate, to: MapCoordinate) {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const toDegrees = (radians: number) => radians * 180 / Math.PI;
  const startLat = toRadians(from.latitude);
  const endLat = toRadians(to.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const y = Math.sin(longitudeDelta) * Math.cos(endLat);
  const x = Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(longitudeDelta);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

export function interpolateCoordinate(from: MapCoordinate, to: MapCoordinate, progress: number): MapCoordinate {
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * progress,
    longitude: from.longitude + (to.longitude - from.longitude) * progress,
  };
}
