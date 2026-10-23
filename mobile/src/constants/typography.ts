/**
 * typography.ts — a compact Inter scale for the rider and driver interfaces.
 *
 * Font: Inter (loaded in src/app/_layout.tsx). Each variant names a specific
 * Inter weight file so the weight renders correctly on both iOS and Android —
 * on custom fonts the *family* carries the weight, so we point at the right
 * family rather than relying on `fontWeight` alone. `fontWeight` is still set as
 * a fallback for the brief moment before fonts finish loading / on web.
 *
 * Screens should never set fontSize/fontFamily by hand — they use the <Text>
 * component (src/components/common/Text.tsx) with a `variant` prop that pulls
 * from this table.
 */
import { Platform, type TextStyle } from 'react-native';

// The exact family strings exported by @expo-google-fonts/inter.
export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

const baseTypography = {
  // Restrained semibold headings and tighter tracking keep titles crisp without
  // overpowering the map, forms, or financial information. Mirror in Tailwind.
  h1: { fontFamily: fontFamily.semibold, fontSize: 30, lineHeight: 36, fontWeight: '600', letterSpacing: -0.7 },
  h2: { fontFamily: fontFamily.semibold, fontSize: 24, lineHeight: 30, fontWeight: '600', letterSpacing: -0.5 },
  h3: { fontFamily: fontFamily.semibold, fontSize: 20, lineHeight: 26, fontWeight: '600', letterSpacing: -0.3 },
  body: { fontFamily: fontFamily.regular, fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyMedium: { fontFamily: fontFamily.medium, fontSize: 15, lineHeight: 22, fontWeight: '500' },
  caption: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 18, fontWeight: '400' },
  button: { fontFamily: fontFamily.semibold, fontSize: 14, lineHeight: 20, fontWeight: '600' },
} satisfies Record<string, TextStyle>;

// Keep the web scale unchanged; Android needs a slightly roomier reading scale.
// Mirror these values in tailwind.config.js, which also styles native inputs.
export const typography = Platform.OS === 'android' ? {
  h1: { ...baseTypography.h1, fontSize: 33, lineHeight: 40 },
  h2: { ...baseTypography.h2, fontSize: 27, lineHeight: 34 },
  h3: { ...baseTypography.h3, fontSize: 23, lineHeight: 30 },
  body: { ...baseTypography.body, fontSize: 17, lineHeight: 26 },
  bodyMedium: { ...baseTypography.bodyMedium, fontSize: 17, lineHeight: 26 },
  caption: { ...baseTypography.caption, fontSize: 15, lineHeight: 22 },
  button: { ...baseTypography.button, fontSize: 16, lineHeight: 24 },
} : baseTypography;

export type TypographyVariant = keyof typeof typography;
