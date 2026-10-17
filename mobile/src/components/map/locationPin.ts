import type { AppColors } from '@/constants/colors';
import { markerColor } from './markerStyle';

export type LocationPinKind = 'pickup' | 'dropoff';

/** Geometry shared by the native Views and the Google Maps web SVG. */
export const locationPin = {
  size: 44,
  head: { left: 7, top: 6, size: 30, radius: 14, tipRadius: 3, borderWidth: 2, rotation: 45 },
  dot: { left: 16, top: 15, size: 12 },
  pole: { left: 15, top: 13, width: 2, height: 18 },
  flag: { left: 18, top: 13, squareWidth: 7, squareHeight: 6 },
} as const;

export function locationPinSvg(kind: LocationPinKind, colors: AppColors): string {
  const color = markerColor(kind, colors);
  const outline = colors.mapMarkerOutline;
  const { size, head, dot, pole, flag } = locationPin;
  // SVG strokes are centered; inset the path to match the native inside border.
  const inset = head.borderWidth / 2;
  const left = head.left + inset;
  const top = head.top + inset;
  const right = head.left + head.size - inset;
  const bottom = head.top + head.size - inset;
  const radius = head.radius - inset;
  const tip = head.tipRadius - inset;
  const centerX = head.left + head.size / 2;
  const centerY = head.top + head.size / 2;
  const path = `M${left + radius} ${top} H${right - radius} A${radius} ${radius} 0 0 1 ${right} ${top + radius}
    V${bottom - tip} A${tip} ${tip} 0 0 1 ${right - tip} ${bottom}
    H${left + radius} A${radius} ${radius} 0 0 1 ${left} ${bottom - radius}
    V${top + radius} A${radius} ${radius} 0 0 1 ${left + radius} ${top} Z`;
  const headSvg = `<path d="${path}" transform="rotate(${head.rotation} ${centerX} ${centerY})" fill="${color}" stroke="${outline}" stroke-width="${head.borderWidth}"/>`;
  const symbol = kind === 'pickup'
    ? `<circle cx="${dot.left + dot.size / 2}" cy="${dot.top + dot.size / 2}" r="${dot.size / 2}" fill="${outline}"/>`
    : `<rect x="${pole.left}" y="${pole.top}" width="${pole.width}" height="${pole.height}" fill="${outline}"/>${[0, 1, 2, 3].map((square) =>
      `<rect x="${flag.left + (square % 2) * flag.squareWidth}" y="${flag.top + Math.floor(square / 2) * flag.squareHeight}" width="${flag.squareWidth}" height="${flag.squareHeight}" fill="${square === 0 || square === 3 ? color : outline}"/>`,
    ).join('')}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${headSvg}${symbol}</svg>`;
}
