import type { MapCoordinate, MapRegion } from '@/store/mapStore';

export type MarkerKind = 'pickup' | 'dropoff' | 'driver' | 'rider' | 'nearby-driver';
export interface AppMapMarker extends MapCoordinate { id: string; kind: MarkerKind; heading?: number; title?: string }
export interface AppMapHandle { animateToRegion: (region: MapRegion) => void; fitToCoordinates: (coordinates: MapCoordinate[]) => void }
export interface AppMapProps {
  region?: MapRegion; markers?: AppMapMarker[]; polyline?: MapCoordinate[]; secondaryPolyline?: MapCoordinate[]; fitRouteOnChange?: boolean; followsUserLocation?: boolean;
  onRegionChange?: (region: MapRegion) => void; onRegionChangeComplete?: (region: MapRegion) => void;
  onUserRegionChangeComplete?: (region: MapRegion) => void;
  mapPadding?: { top: number; right: number; bottom: number; left: number }; showsUserLocation?: boolean;
}
