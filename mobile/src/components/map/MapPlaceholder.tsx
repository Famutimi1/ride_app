/**
 * MapPlaceholder — a themed stand-in for the live map on the rider home.
 *
 * The real map needs a native mapping library (react-native-maps or Mapbox), a
 * Google Maps API key, and a custom dev build — a MAJOR dependency we haven't
 * added yet (AGENTS.md §10 says flag major deps before adding them). So for now
 * this draws a light, map-ish surface with a faint street grid, a pickup marker
 * and a parked car, and accepts `children` for overlays (the ETA pill).
 *
 * When we wire a real map, only THIS file changes — screens keep composing
 * <MapPlaceholder>…</MapPlaceholder> exactly the same way, the same trick
 * <HeroIllustration> uses for the onboarding art.
 */
import { View, type ViewStyle } from 'react-native';

import { Text } from '@/components/common';
import { useTheme } from '@/constants/theme';

export interface MapPlaceholderProps {
  /** Overlays drawn on top of the map (e.g. the ETA pill). */
  children?: React.ReactNode;
  style?: ViewStyle;
}

export function MapPlaceholder({ children, style }: MapPlaceholderProps) {
  const theme = useTheme();

  // A single faint "road": a thin bar in the border colour. We scatter a few at a
  // slight angle to suggest a street grid without pretending to be a real map.
  const road = (extra: ViewStyle) => (
    <View
      style={[
        { position: 'absolute', backgroundColor: theme.colors.border, opacity: 0.7 },
        extra,
      ]}
    />
  );

  return (
    <View
      style={[
        { flex: 1, backgroundColor: theme.colors.surfaceMuted, overflow: 'hidden' },
        style,
      ]}
    >
      {/* Decorative street grid — purely cosmetic until the real map lands. */}
      {road({ top: '24%', left: -40, right: -40, height: 10, transform: [{ rotate: '-12deg' }] })}
      {road({ top: '54%', left: -40, right: -40, height: 16, transform: [{ rotate: '-12deg' }] })}
      {road({ top: '80%', left: -40, right: -40, height: 8, transform: [{ rotate: '-12deg' }] })}
      {road({ top: -40, bottom: -40, left: '38%', width: 12, transform: [{ rotate: '-12deg' }] })}
      {road({ top: -40, bottom: -40, left: '66%', width: 8, transform: [{ rotate: '-12deg' }] })}

      {/* A parked car + the rider's pickup dot, echoing the mockup. */}
      <View style={{ position: 'absolute', top: '40%', left: '54%' }}>
        <Text variant="h3">🚗</Text>
      </View>
      <View
        style={{
          position: 'absolute',
          top: '46%',
          left: '32%',
          width: 18,
          height: 18,
          borderRadius: theme.radius.full,
          backgroundColor: theme.colors.danger, // the palette's only red — used as the pin
          borderWidth: 3,
          borderColor: theme.colors.surface,
        }}
      />

      {/* Overlays passed by the screen (the ETA pill sits here). */}
      {children}

      {/* Map-data attribution chip, like the mockup's "G Google". */}
      <View
        style={{
          position: 'absolute',
          bottom: theme.spacing.md,
          left: theme.spacing.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          backgroundColor: theme.colors.surface,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: 6,
          borderRadius: theme.radius.full,
          ...theme.elevation.sm,
        }}
      >
        <Text variant="bodyMedium">G</Text>
        <Text variant="caption" color="textMuted">
          Google
        </Text>
      </View>
    </View>
  );
}
