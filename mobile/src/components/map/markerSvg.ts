import type { AppColors } from '@/constants/colors';
import { locationPinSvg } from './locationPin';
import type { MarkerKind } from './mapTypes';
import { markerColor } from './markerStyle';

/** One set of artwork for Google Maps web icons and native marker snapshots. */
export function markerSvg(kind: MarkerKind, colors: AppColors, heading = 0): string {
  if (kind === 'pickup' || kind === 'dropoff') return locationPinSvg(kind, colors);
  const color = markerColor(kind, colors);
  const rotation = Number.isFinite(heading) ? heading : 0;
  const glyph = kind === 'rider'
    ? `<path d="M5 5 24 43 43 5 24 14Z" fill="${color}" stroke="${colors.mapMarkerOutline}" stroke-width="3" stroke-linejoin="round"/>`
    : `<g transform="rotate(${rotation} 24 24)"><rect x="12" y="3" width="24" height="42" rx="9" fill="${kind === 'driver' ? color : colors.surface}" stroke="${color}" stroke-width="3"/><path d="M17 12h14l2 10H15zM17 31h14l-2 8H19z" fill="${kind === 'driver' ? colors.textInverse : color}"/><path d="M10 15h3m22 0h3M10 34h3m22 0h3" stroke="${color}" stroke-width="3" stroke-linecap="round"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${glyph}</svg>`;
}
