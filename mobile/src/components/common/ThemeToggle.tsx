/**
 * ThemeToggle — a round button that flips the app between light and dark mode.
 *
 * It shows the CURRENT mode as a glyph (☀️ in light, 🌙 in dark) and, on tap, calls
 * uiStore.toggleTheme() — which every screen's useTheme() is subscribed to, so the
 * whole app re-themes instantly. Styled to match BackButton (a text glyph in a
 * surface-muted circle) since the project has no icon library yet.
 *
 * Two looks (same button, same behaviour):
 *   • default   — a subtle surface-muted circle, for use ON a normal screen
 *                 (e.g. a future Profile → Preferences row).
 *   • floating  — a white, elevated circle, for sitting ON TOP of the map on the
 *                 rider home (matches the mockup's floating controls).
 *
 * Usage:
 *   <ThemeToggle />            // on-surface
 *   <ThemeToggle floating />   // over the map
 */
import { Pressable } from 'react-native';

import { useTheme } from '@/constants/theme';
import { useUiStore } from '@/store/uiStore';

import { Text } from './Text';

export interface ThemeToggleProps {
  /** Use the white, elevated look for floating over the map. */
  floating?: boolean;
}

export function ThemeToggle({ floating = false }: ThemeToggleProps) {
  const theme = useTheme();
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const isDark = theme.scheme === 'dark';

  return (
    <Pressable
      onPress={toggleTheme}
      accessibilityRole="button"
      // Announce the ACTION (what tapping does), not just the current state.
      accessibilityLabel={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      hitSlop={8}
      style={({ pressed }) => ({
        width: floating ? 48 : 40,
        height: floating ? 48 : 40,
        borderRadius: theme.radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        // Floating sits on the map → white + shadow so it stands out; on-surface
        // uses the muted fill so it reads as a control within a card.
        backgroundColor: floating ? theme.colors.surface : theme.colors.surfaceMuted,
        opacity: pressed ? 0.6 : 1,
        ...(floating ? theme.elevation.sm : null),
      })}
    >
      <Text variant="bodyMedium">{isDark ? '🌙' : '☀️'}</Text>
    </Pressable>
  );
}
