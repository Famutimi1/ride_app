import type { MapCoordinate } from '@/store/mapStore';

export function decodePolyline(encoded: string): MapCoordinate[] {
  const points: MapCoordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const decodeValue = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= encoded.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    latitude += decodeValue();
    longitude += decodeValue();
    points.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
  }
  return points;
}

/** Include the selected addresses, which Google Directions may snap to nearby roads. */
export function anchorPolyline(points: MapCoordinate[], start: MapCoordinate, end: MapCoordinate): MapCoordinate[] {
  if (points.length < 2) return [];
  return [start, ...points, end];
}
