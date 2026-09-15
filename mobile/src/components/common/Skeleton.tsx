/**
 * Skeleton — a pulsing placeholder block shown while real content loads
 * (driver card, trip history rows, wallet balance, etc.). Better than a bare
 * spinner because it hints at the shape of what's coming.
 *
 * It's a rounded rectangle in the theme's `skeleton` colour whose opacity gently
 * pulses via Reanimated (which runs the animation on the UI thread, so it stays
 * smooth even while JS is busy fetching).
 *
 * Usage:
 *   <Skeleton width="100%" height={20} />
 *   <Skeleton width={44} height={44} radius="full" />   // avatar placeholder
 */
import { vars } from 'nativewind';
import { useEffect } from 'react';
import { type DimensionValue, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import type { Radius } from '@/constants/spacing';

const RADIUS_CLASSES: Record<Radius, string> = {
  xs: 'rounded-xs',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  full: 'rounded-full',
};

export interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  /** Corner radius token. Defaults to `sm`; use `full` for circles. */
  radius?: Radius;
}

export function Skeleton({ width = '100%', height = 16, radius = 'sm' }: SkeletonProps) {
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    // Fade 0.5 → 1 and back, forever. The `true` makes it reverse (pulse)
    // rather than jump back to the start each loop.
    opacity.value = withRepeat(withTiming(1, { duration: 800 }), -1, true);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const dimensions = vars({
    '--skeleton-width': width as string | number,
    '--skeleton-height': height as string | number,
  });

  return (
    // Reanimated's Animated.View gets the animated opacity; a normal View carries
    // the NativeWind classes. NativeWind classes on Animated.View are not reliable
    // on iOS/Android, so we never pass `className` to it.
    <Animated.View style={animatedStyle}>
      <View
        className={`h-[--skeleton-height] w-[--skeleton-width] overflow-hidden bg-skeleton ${RADIUS_CLASSES[radius]}`}
        style={dimensions}
      />
    </Animated.View>
  );
}
