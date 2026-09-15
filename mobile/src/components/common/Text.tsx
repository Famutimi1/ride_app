/**
 * Text — the themed replacement for React Native's <Text>.
 *
 * Every piece of text in the app goes through this component so that:
 *   • font size / weight / line-height come from the typography scale (never
 *     hard-coded on a screen), and
 *   • colour comes from the active theme's semantic tokens (so it auto-swaps in
 *     dark mode).
 *
 * Usage:
 *   <Text variant="h1">Good morning</Text>
 *   <Text variant="caption" color="textMuted">3 trips today</Text>
 *
 * `color` takes a semantic token name (e.g. "text", "textMuted", "primary",
 * "danger"). It defaults to the primary body-text colour.
 */
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import type { AppColors } from '@/constants/colors';
import type { TypographyVariant } from '@/constants/typography';

const VARIANT_CLASSES: Record<TypographyVariant, string> = {
  h1: '!font-inter-bold !text-h1 font-bold',
  h2: '!font-inter-bold !text-h2 font-bold',
  h3: '!font-inter-semibold !text-h3 font-semibold',
  body: '!font-inter-regular !text-body font-normal',
  bodyMedium: '!font-inter-medium !text-body font-medium',
  caption: '!font-inter-regular !text-caption font-normal',
  button: '!font-inter-medium !text-button font-medium',
};

const COLOR_CLASSES: Record<keyof AppColors, string> = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  mapPickup: 'text-mapPickup',
  mapDropoff: 'text-mapDropoff',
  mapDriver: 'text-mapDriver',
  mapNearbyDriver: 'text-mapNearbyDriver',
  primarySoft: 'text-primarySoft',
  successSoft: 'text-successSoft',
  warningSoft: 'text-warningSoft',
  dangerSoft: 'text-dangerSoft',
  background: 'text-background',
  surface: 'text-surface',
  surfaceMuted: 'text-surfaceMuted',
  border: 'text-border',
  borderStrong: 'text-borderStrong',
  text: 'text-text',
  textMuted: 'text-textMuted',
  textInverse: 'text-textInverse',
  icon: 'text-icon',
  overlay: 'text-overlay',
  skeleton: 'text-skeleton',
};

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  /** A semantic colour token from the theme. Defaults to `text`. */
  color?: keyof AppColors;
}

export function Text({
  variant = 'body',
  color = 'text',
  className,
  ...rest
}: TextProps) {
  return (
    <RNText
      // Order matters: variant styles first, then the theme colour, then any
      // caller `className` override wins last.
      className={[VARIANT_CLASSES[variant], COLOR_CLASSES[color], className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );
}
