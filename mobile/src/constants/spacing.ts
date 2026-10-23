/**
 * spacing.ts — shared spacing and radii for compact, readable layouts.
 *
 * Using a fixed scale (rather than arbitrary numbers like `padding: 13`) keeps
 * every screen visually consistent and makes global tweaks a one-line change.
 * Reference these via `useTheme()` → `spacing.lg`, `radius.md`.
 */

import { Platform, StyleSheet } from 'react-native';

// One Android layout pixel stays visible on high-density screens. A physical
// hairline otherwise becomes faint or disappears when the emulator is scaled.
export const borderWidths = { divider: Platform.OS === 'android' ? 1 : StyleSheet.hairlineWidth } as const;

// Keep small gaps comfortable; tighten page gutters and large section gaps.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 28,
  '3xl': 40,
} as const;

// Compact radii for controls and content containers. Full remains reserved for
// pills, avatars, and circular buttons; screen sheets define their top corners.
export const radius = {
  xs: 3,
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  full: 9999, // pills, avatars, circular buttons
} as const;

// Elevation tokens are now handled by Tailwind's `shadow-*` utilities, but the
// named presets still exist as a type for components like `Card`.
export type Elevation = 'none' | 'sm' | 'md' | 'lg';

export type Spacing = keyof typeof spacing;
export type Radius = keyof typeof radius;
