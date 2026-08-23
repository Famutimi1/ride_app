/**
 * spacing.ts — the Spacing, Radii and Elevation scales from the mockup.
 *
 * Using a fixed scale (rather than arbitrary numbers like `padding: 13`) keeps
 * every screen visually consistent and makes global tweaks a one-line change.
 * Reference these via `useTheme()` → `spacing.lg`, `radius.md`, `elevation.md`.
 */
import type { ViewStyle } from 'react-native';

// Mockup "Spacing (px)" row: 4 · 8 · 12 · 16 · 24 · 32 · 48
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
} as const;

// Mockup "Radii / Border presets": 4 · 8 · 12 · 16 · 24 · full(9999)
export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999, // pills, avatars, circular buttons
} as const;

/**
 * Elevation presets. React Native shadows are split: iOS uses shadow* props,
 * Android uses the single `elevation` number. Each preset sets both so a card
 * looks right on either platform. Exact mockup shadow values aren't legible, so
 * these are sensible tiers (subtle → prominent) matching the mock's light/med/
 * high cards. Shadows are barely visible on dark backgrounds — that's expected.
 */
export const elevation = {
  none: {},
  sm: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  md: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  lg: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
} satisfies Record<string, ViewStyle>;

export type Spacing = keyof typeof spacing;
export type Radius = keyof typeof radius;
export type Elevation = keyof typeof elevation;
