import type { AppColors } from '@/constants/colors';
import type { MarkerKind } from './mapTypes';

export function markerColor(kind: MarkerKind, colors: AppColors): string {
  switch (kind) {
    case 'pickup': return colors.mapPickup;
    case 'dropoff': return colors.mapDropoff;
    case 'driver': return colors.mapDriver;
    case 'nearby-driver': return colors.mapNearbyDriver;
    case 'rider': return colors.mapRider;
  }
}

export function markerSize(kind: MarkerKind): number {
  switch (kind) {
    case 'driver': return 44;
    case 'nearby-driver': return 32;
    case 'rider': return 44;
    default: return 44;
  }
}

export function markerAnchor(kind: MarkerKind): { x: number; y: number } {
  return kind === 'pickup' || kind === 'dropoff' || kind === 'rider' ? { x: 0.5, y: 1 } : { x: 0.5, y: 0.5 };
}
