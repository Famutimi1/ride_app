/**
 * colors.ts — the SINGLE source of truth for every colour in the app.
 *
 * How this file is layered (read top to bottom):
 *   1. `palette`      — raw hex values. This is the ONLY place hex is allowed to
 *                       live in the whole codebase. Re-skin the app by editing
 *                       these values and nothing else.
 *   2. `brand`        — semantic brand colours that mean the same thing in light
 *                       AND dark mode (a primary button is blue in both).
 *   3. `lightColors`  — semantic tokens for light mode (background/text/border…).
 *   4. `darkColors`   — the SAME token names, swapped to dark values.
 *
 * Components must reference the semantic tokens (e.g. `colors.primary`,
 * `colors.background`) via the `useTheme()` hook — never `palette.*` and never a
 * raw hex string inline. That indirection is what lets light/dark work by simply
 * swapping which token set is active. (See AGENTS.md §7.)
 *
 * Palette values come from the approved design mockup (a Tailwind-derived scale).
 * The 10 named colours in the mockup don't cover everything a real screen needs
 * (borders, muted text, tinted pill backgrounds), so a few extra neutral steps
 * from the same gray/slate families are included below — still all in this one
 * file, still swap-to-reskin.
 */

// ── 1. Raw palette — the only hex in the app ─────────────────────────────────
const palette = {
  // Brand / status (straight from the mockup's colors.ts)
  blue700: '#1D4ED8', // primary  — actions
  slate500: '#64748B', // secondary
  green600: '#16A34A', // success  — online / earnings-in
  amber500: '#F59E0B', // warning  — star ratings + warnings
  red600: '#DC2626', // danger   — decline / earnings-out

  // Neutrals — light surfaces & text (mockup: neutral / lightText)
  white: '#FFFFFF',
  gray50: '#F9FAFB',
  gray100: '#F3F4F6', // neutral
  gray200: '#E5E7EB', // darkText (used as text ON dark surfaces)
  gray300: '#D1D5DB',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray900: '#111827', // lightText (primary text ON light surfaces)

  // Neutrals — dark surfaces (mockup: dark / darkSecondary)
  slate900: '#0F172A', // dark          — app background in dark mode
  slate800: '#1E293B', // darkSecondary — cards/surfaces in dark mode
  slate700: '#334155',
  slate600: '#475569',
} as const;

// ── 2. Brand tokens — identical in both themes ──────────────────────────────
const brand = {
  primary: palette.blue700,
  secondary: palette.slate500,
  success: palette.green600,
  warning: palette.amber500, // amber == ratings + warnings
  danger: palette.red600,
} as const;

// Soft tinted backgrounds for status pills / badges. Kept as rgba over the base
// hue so they read correctly on both light and dark surfaces.
const tint = {
  primarySoft: 'rgba(29, 78, 216, 0.12)',
  successSoft: 'rgba(22, 163, 74, 0.12)',
  warningSoft: 'rgba(245, 158, 11, 0.14)',
  dangerSoft: 'rgba(220, 38, 38, 0.12)',
} as const;

// ── 3. Light theme semantic tokens ──────────────────────────────────────────
export const lightColors = {
  ...brand,
  ...tint,

  background: palette.white, // screen background
  surface: palette.white, // cards, sheets
  surfaceMuted: palette.gray100, // subtle filled areas (inputs, chips)
  border: palette.gray200, // hairlines, dividers, input outlines
  borderStrong: palette.gray300,

  text: palette.gray900, // primary text
  textMuted: palette.gray500, // secondary/caption text
  textInverse: palette.white, // text on a filled primary button
  icon: palette.gray500,

  overlay: 'rgba(15, 23, 42, 0.45)', // dim behind modals/bottom sheets
  skeleton: palette.gray200, // loading placeholders
} as const;

// ── 4. Dark theme semantic tokens (same keys, dark values) ──────────────────
export const darkColors: AppColors = {
  ...brand,
  ...tint,

  background: palette.slate900,
  surface: palette.slate800,
  surfaceMuted: palette.slate700,
  border: palette.slate700,
  borderStrong: palette.slate600,

  text: palette.gray200,
  textMuted: palette.gray400,
  textInverse: palette.white,
  icon: palette.gray400,

  overlay: 'rgba(0, 0, 0, 0.6)',
  skeleton: palette.slate700,
} as const;

// The shape every screen/component codes against. We take the KEY NAMES from
// `lightColors` but widen the values to `string` — so `darkColors` (annotated
// `AppColors`) is forced to define exactly the same tokens, while still being
// free to give each a different hex. Add a token to light and TypeScript makes
// you add it to dark too; miss one and it won't compile.
export type AppColors = Record<keyof typeof lightColors, string>;
