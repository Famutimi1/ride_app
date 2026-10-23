import type { MapRegion } from '@/store/mapStore';

/** Keep street zoom consistent between Google Maps web and Android. */
export function zoomForRegion(region: MapRegion): number {
  return Math.max(4, Math.min(19, Math.round(Math.log2(360 / Math.max(region.longitudeDelta, 0.001)))));
}
