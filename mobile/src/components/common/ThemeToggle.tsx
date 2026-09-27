/**
 * ThemeToggle — a round button that flips the app between light and dark mode.
 *
 * It shows the CURRENT mode as a glyph (☀️ in light, 🌙 in dark) and, on tap, calls
 * uiStore.setThemePreference() using the opposite resolved scheme, so the
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
  const setThemePreference = useUiStore((s) => s.setThemePreference);
  const isDark = theme.scheme === 'dark';

  return (
    <Pressable
      onPress={() => setThemePreference(isDark ? 'light' : 'dark')}
      accessibilityRole="button"
      // Announce the ACTION (what tapping does), not just the current state.
      accessibilityLabel={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      hitSlop={8}
      // Floating sits on the map → white + shadow so it stands out; on-surface
      // uses the muted fill so it reads as a control within a card.
      className={[
        'items-center justify-center rounded-full active:opacity-60',
        floating ? 'h-12 w-12 bg-surface shadow-sm' : 'h-10 w-10 bg-surfaceMuted',
      ].join(' ')}
    >
      <Text variant="bodyMedium">{isDark ? '🌙' : '☀️'}</Text>
    </Pressable>
  );
}
