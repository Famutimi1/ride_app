/**
 * typography.ts — the text styles from the mockup's Typography table.
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
import type { TextStyle } from 'react-native';

// The exact family strings exported by @expo-google-fonts/inter.
export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const typography = {
  // From the mockup table (Inter). H1 read as ~38.4 in the mock → rounded to 38.
  h1: { fontFamily: fontFamily.bold, fontSize: 38, lineHeight: 44, fontWeight: '700' },
  h2: { fontFamily: fontFamily.bold, fontSize: 32, lineHeight: 40, fontWeight: '700' },
  h3: { fontFamily: fontFamily.semibold, fontSize: 28, lineHeight: 36, fontWeight: '600' },
  // `body` wasn't an explicit row in the mockup table but every screen needs it;
  // 16/24 is the standard body size that sits below the H3/Caption rows shown.
  body: { fontFamily: fontFamily.regular, fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyMedium: { fontFamily: fontFamily.medium, fontSize: 16, lineHeight: 24, fontWeight: '500' },
  caption: { fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 20, fontWeight: '400' },
  button: { fontFamily: fontFamily.medium, fontSize: 15, lineHeight: 22, fontWeight: '500' },
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;
