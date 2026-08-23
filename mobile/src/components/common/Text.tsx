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
import { useTheme } from '@/constants/theme';
import type { TypographyVariant } from '@/constants/typography';

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  /** A semantic colour token from the theme. Defaults to `text`. */
  color?: keyof AppColors;
}

export function Text({
  variant = 'body',
  color = 'text',
  style,
  ...rest
}: TextProps) {
  const theme = useTheme();

  return (
    <RNText
      // Order matters: variant styles first, then the theme colour, then any
      // caller `style` override wins last.
      style={[theme.typography[variant], { color: theme.colors[color] }, style]}
      {...rest}
    />
  );
}
