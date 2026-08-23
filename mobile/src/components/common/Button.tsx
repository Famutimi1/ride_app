/**
 * Button — the app's pressable action, matching the mockup's four button styles.
 *
 * Variants (from the mockup's component library):
 *   • primary     — solid brand blue, white label. The main call-to-action.
 *   • secondary   — subtle filled surface, normal text. Lower emphasis.
 *   • ghost       — transparent, brand-coloured label. A "text button".
 *   • destructive — solid danger red. Cancel trip, delete, sign out, etc.
 *
 * States handled for you: pressed (dims slightly), disabled (fades + ignores
 * taps), loading (swaps the label for a spinner and blocks taps).
 *
 * Usage:
 *   <Button label="Confirm ride" onPress={...} />
 *   <Button label="Cancel" variant="destructive" loading={submitting} />
 */
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  View,
} from 'react-native';

import { useTheme } from '@/constants/theme';

import { Text } from './Text';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Stretch to fill the parent's width (typical for bottom-of-screen CTAs). */
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const HEIGHTS: Record<ButtonSize, number> = { sm: 40, md: 52, lg: 56 };

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  leftIcon,
  rightIcon,
  disabled,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  // Resolve background + label colour per variant from the ACTIVE theme.
  const bg = {
    primary: theme.colors.primary,
    secondary: theme.colors.surfaceMuted,
    ghost: 'transparent',
    destructive: theme.colors.danger,
  }[variant];

  const labelColorByVariant = {
    primary: 'textInverse',
    secondary: 'text',
    ghost: 'primary',
    destructive: 'textInverse',
  } as const;
  const labelColor = labelColorByVariant[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          height: HEIGHTS[size],
          borderRadius: theme.radius.md,
          backgroundColor: bg,
          paddingHorizontal: theme.spacing.xl,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
        fullWidth && styles.fullWidth,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={theme.colors[labelColor]} />
      ) : (
        <View style={styles.content}>
          {leftIcon}
          <Text variant="button" color={labelColor}>
            {label}
          </Text>
          {rightIcon}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
