/**
 * BackButton — the round, tappable back chevron used at the top-left of the OTP
 * and Profile screens (and inside AuthScreenLayout).
 *
 * Pulled into the shared library so all three places render an identical control.
 * Uses a text glyph (‹) because the project has no icon library yet — see
 * docs/design/design-system.md.
 */
import { Pressable } from 'react-native';

import { useTheme } from '@/constants/theme';

import { Text } from './Text';

export function BackButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={8}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: theme.radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceMuted,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {/* Nudge up a hair so the chevron optically centres in the circle. */}
      <Text variant="h3" style={{ marginTop: -2 }}>
        ‹
      </Text>
    </Pressable>
  );
}
