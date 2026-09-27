/**
 * Input — a themed text field with a label and optional error message.
 *
 * Three visual states from the mockup, handled automatically:
 *   • default  — hairline border
 *   • focused  — border switches to brand green (tracked via onFocus/onBlur)
 *   • error    — border + message turn danger red (pass an `error` string)
 *
 * Usage:
 *   <Input label="Phone number" value={phone} onChangeText={setPhone}
 *          keyboardType="phone-pad" />
 *   <Input label="Email" error="That email looks off" ... />
 */
import { useState } from 'react';
import {
  TextInput,
  type StyleProp,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';

import { Text } from './Text';
import { useTheme } from '@/constants/theme';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  /** Optional sizing/layout override for the visible input shell. */
  containerClassName?: string;
  /** Native style override for screen-specific shell dimensions or borders. */
  containerStyle?: StyleProp<ViewStyle>;
}

export function Input({
  label,
  error,
  leftIcon,
  rightIcon,
  containerClassName,
  containerStyle,
  onFocus,
  onBlur,
  className,
  ...rest
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const { colors } = useTheme();

  // Border colour is a small priority ladder: error beats focus beats default.
  const borderClass = error
    ? 'border-danger'
    : focused
      ? 'border-primary'
      : 'border-borderStrong';

  return (
    <View className="gap-[6px]">
      {label && (
        <Text variant="caption" color="textMuted" className="ml-[2px]">
          {label}
        </Text>
      )}

      <View
        style={containerStyle}
        className={[
          'h-[52px] flex-row items-center gap-sm rounded-md border bg-surfaceMuted px-lg',
          borderClass,
          containerClassName,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {leftIcon}
        <TextInput
          accessibilityLabel={label ?? rest.placeholder}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.primary}
          // Merge the body type style so the text matches the rest of the app,
          // then force the themed text colour (RN ignores inherited colour).
          // Kill the default vertical padding so text centres in our fixed height.
          className={[
            'flex-1 border-0 py-0 font-inter-regular text-body font-normal text-text outline-none placeholder:text-textMuted',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        {rightIcon}
      </View>

      {error && (
        <Text variant="caption" color="danger" className="ml-[2px]">
          {error}
        </Text>
      )}
    </View>
  );
}
