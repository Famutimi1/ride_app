/**
 * theme.ts — assembles the full theme and exposes the `useTheme()` hook every
 * component uses to read colours/spacing/type for the CURRENT colour scheme.
 *
 * Right now the active scheme comes from the OS (`useColorScheme`), which is
 * correct default behaviour and matches app.json's "userInterfaceStyle":
 * "automatic". When the Zustand `uiStore` lands (per AGENTS.md), it will be able
 * to OVERRIDE this with a manual Light/Dark toggle (the Preferences row in the
 * Profile screen) — at that point this hook reads the store first and falls back
 * to the OS scheme. Keeping that logic here means screens never change.
 */
import { useColorScheme } from 'react-native';

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

/** The hook screens/components call. Follows the OS light/dark setting. */
export function useTheme(): Theme {
  // useColorScheme() is 'light' | 'dark' | null; treat anything non-dark as light.
  const scheme: ColorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return getTheme(scheme);
}

export { lightColors, darkColors, typography, spacing, radius, elevation };
export type { AppColors };
