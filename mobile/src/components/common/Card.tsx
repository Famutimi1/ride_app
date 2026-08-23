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
import { useTheme } from '@/constants/theme';

export interface CardProps extends ViewProps {
  /** Shadow depth preset. Defaults to `sm`. Use `none` for a flat panel. */
  elevation?: Elevation;
  /** Inner padding, from the spacing scale. Defaults to `lg` (16). */
  padding?: Spacing;
}

export function Card({
  elevation = 'sm',
  padding = 'lg',
  style,
  ...rest
}: CardProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          padding: theme.spacing[padding],
        },
        theme.elevation[elevation],
        style,
      ]}
      {...rest}
    />
  );
}
