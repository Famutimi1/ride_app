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
import { View } from 'react-native';

import { Text } from '@/components/common';

export interface MapPlaceholderProps {
  /** Overlays drawn on top of the map (e.g. the ETA pill). */
  children?: React.ReactNode;
  className?: string;
}

export function MapPlaceholder({ children, className }: MapPlaceholderProps) {
  // A single faint "road": a thin bar in the border colour. We scatter a few at a
  // slight angle to suggest a street grid without pretending to be a real map.
  const road = (roadClassName: string) => (
    <View className={`absolute bg-border opacity-70 ${roadClassName}`} />
  );

  return (
    <View
      className={['flex-1 overflow-hidden bg-surfaceMuted', className]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Decorative street grid — purely cosmetic until the real map lands. */}
      {road('-left-10 -right-10 top-[24%] h-2.5 -rotate-12')}
      {road('-left-10 -right-10 top-[54%] h-4 -rotate-12')}
      {road('-left-10 -right-10 top-[80%] h-2 -rotate-12')}
      {road('-bottom-10 -top-10 left-[38%] w-3 -rotate-12')}
      {road('-bottom-10 -top-10 left-[66%] w-2 -rotate-12')}

      {/* A parked car + the rider's pickup dot, echoing the mockup. */}
      <View className="absolute left-[54%] top-[40%]">
        <Text variant="h3">🚗</Text>
      </View>
      <View
        // the palette's only red — used as the pin
        className="absolute left-[32%] top-[46%] h-[18px] w-[18px] rounded-full border-[3px] border-surface bg-danger"
      />

      {/* Overlays passed by the screen (the ETA pill sits here). */}
      {children}

      {/* Map-data attribution chip, like the mockup's "G Google". */}
      <View className="absolute bottom-md left-md flex-row items-center gap-[6px] rounded-full bg-surface px-sm py-[6px] shadow-sm">
        <Text variant="bodyMedium">G</Text>
        <Text variant="caption" color="textMuted">
          Google
        </Text>
      </View>
    </View>
  );
}
