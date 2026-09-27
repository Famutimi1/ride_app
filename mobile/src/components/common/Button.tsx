/**
 * Button — the app's pressable action, matching the mockup's button styles.
 *
 * Variants (from the mockup's component library):
 *   • primary     — solid brand green, white label. The main call-to-action.
 *   • secondary   — subtle filled surface, normal text. Lower emphasis.
 *   • outline     — transparent with a hairline border (e.g. "Sign up with Google").
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
import { ActivityIndicator, Pressable, type PressableProps, View } from 'react-native';

import { useTheme } from '@/constants/theme';

import { Text } from './Text';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
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

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-10 rounded-md',
  md: 'h-[52px] rounded-md',
  lg: 'h-14 rounded-lg',
};

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  leftIcon,
  rightIcon,
  disabled,
  className,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  // Resolve background + label colour per variant from the ACTIVE theme.
  const bg = {
    primary: 'bg-primary',
    secondary: 'bg-surfaceMuted',
    outline: 'border border-borderStrong bg-transparent',
    ghost: 'bg-transparent',
    destructive: 'bg-danger',
  }[variant];

  const labelColorByVariant = {
    primary: 'textInverse',
    secondary: 'text',
    outline: 'text',
    ghost: 'primary',
    destructive: 'textInverse',
  } as const;
  const labelColor = labelColorByVariant[variant];

  // Outline is the only variant with a visible border (the Google button).
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      className={[
        'items-center justify-center px-xl',
        SIZE_CLASSES[size],
        bg,
        fullWidth ? 'self-stretch' : '',
        isDisabled ? 'opacity-50' : 'active:opacity-[0.85]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={theme.colors[labelColor]} />
      ) : (
        <View className="flex-row items-center gap-sm">
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
