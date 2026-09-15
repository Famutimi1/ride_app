/**
 * Card — a themed surface container (the white/dark rounded panels in the mockup).
 *
 * It's a plain <View> with the theme's surface colour, a rounded corner and an
 * optional elevation (drop shadow). Use it for anything that should read as a
 * raised panel: the fare breakdown, a driver info card, a wallet balance box.
 *
 * Usage:
 *   <Card>…</Card>                       // default: md padding, sm elevation
 *   <Card elevation="lg" padding="xl">…</Card>
 *   <Card elevation="none">…</Card>      // flat, just a rounded surface
 */
import { type ViewProps, View } from 'react-native';

import type { Elevation, Spacing } from '@/constants/spacing';

const ELEVATION_CLASSES: Record<Elevation, string> = {
  none: 'shadow-none',
  sm: 'shadow-sm',
  md: 'shadow-md',
  lg: 'shadow-lg',
};

const PADDING_CLASSES: Record<Spacing, string> = {
  xs: 'p-xs',
  sm: 'p-sm',
  md: 'p-md',
  lg: 'p-lg',
  xl: 'p-xl',
  '2xl': 'p-2xl',
  '3xl': 'p-3xl',
};

export interface CardProps extends ViewProps {
  /** Shadow depth preset. Defaults to `sm`. Use `none` for a flat panel. */
  elevation?: Elevation;
  /** Inner padding, from the spacing scale. Defaults to `lg` (16). */
  padding?: Spacing;
}

export function Card({
  elevation = 'sm',
  padding = 'lg',
  className,
  ...rest
}: CardProps) {
  return (
    <View
      className={[
        'rounded-lg bg-surface',
        ELEVATION_CLASSES[elevation],
        PADDING_CLASSES[padding],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );
}
