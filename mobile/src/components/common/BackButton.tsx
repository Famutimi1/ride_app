/**
 * BackButton — the round, tappable back chevron used at the top-left of the OTP
 * and Profile screens (and inside AuthScreenLayout).
 *
 * Pulled into the shared library so all three places render an identical control.
 * Uses a text glyph (‹) because the project has no icon library yet — see
 * docs/design/design-system.md.
 */
import { Pressable } from 'react-native';

import { Text } from './Text';

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={8}
      className="h-10 w-10 items-center justify-center rounded-full bg-surfaceMuted active:opacity-60"
    >
      {/* Nudge up a hair so the chevron optically centres in the circle. */}
      <Text variant="h3" className="-mt-0.5">
        ‹
      </Text>
    </Pressable>
  );
}
