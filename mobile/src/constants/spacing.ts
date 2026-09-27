/**
 * spacing.ts — the Spacing and Radii scales from the mockup.
 *
 * Using a fixed scale (rather than arbitrary numbers like `padding: 13`) keeps
 * every screen visually consistent and makes global tweaks a one-line change.
 * Reference these via `useTheme()` → `spacing.lg`, `radius.md`.
 */

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
