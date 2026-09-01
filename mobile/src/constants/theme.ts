/**
 * theme.ts — assembles the full theme and exposes the `useTheme()` hook every
 * component uses to read colours/spacing/type for the CURRENT colour scheme.
 *
 * The active scheme comes from the user's saved preference in `uiStore` first, and
 * falls back to the OS setting (`useColorScheme`) only when that preference is
 * 'system'. The default preference is 'light', so the app opens in white mode; the
 * homepage toggle button flips it to dark. Resolving the scheme here (not per screen)
 * means every component re-themes automatically when the toggle is pressed.
 */
import { useColorScheme } from 'react-native';

import { useUiStore } from '@/store/uiStore';

import { darkColors, lightColors, type AppColors } from './colors';
import { elevation, radius, spacing } from './spacing';
import { typography } from './typography';

export type ColorScheme = 'light' | 'dark';

export interface Theme {
  scheme: ColorScheme;
  colors: AppColors;
  typography: typeof typography;
  spacing: typeof spacing;
  radius: typeof radius;
  elevation: typeof elevation;
}

/** Build a theme object for a known scheme (handy for tests / Storybook). */
export function getTheme(scheme: ColorScheme): Theme {
  return {
    scheme,
    colors: scheme === 'dark' ? darkColors : lightColors,
    typography,
    spacing,
    radius,
    elevation,
  };
}

/** The hook screens/components call. Preference (uiStore) wins; OS is the fallback. */
export function useTheme(): Theme {
  const preference = useUiStore((s) => s.themePreference);
  // useColorScheme() is 'light' | 'dark' | null; only consulted for 'system'.
  const osScheme: ColorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const scheme: ColorScheme = preference === 'system' ? osScheme : preference;
  return getTheme(scheme);
}

export { lightColors, darkColors, typography, spacing, radius, elevation };
export type { AppColors };
