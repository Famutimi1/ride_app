/**
 * Input — a themed text field with a label and optional error message.
 *
 * Three visual states from the mockup, handled automatically:
 *   • default  — hairline border
 *   • focused  — border switches to brand blue (tracked via onFocus/onBlur)
 *   • error    — border + message turn danger red (pass an `error` string)
 *
 * Usage:
 *   <Input label="Phone number" value={phone} onChangeText={setPhone}
 *          keyboardType="phone-pad" />
 *   <Input label="Email" error="That email looks off" ... />
 */
import { useState } from 'react';
import { TextInput, type TextInputProps, View } from 'react-native';

import { Text } from './Text';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  /** Optional sizing/layout override for the visible input shell. */
  containerClassName?: string;
}

export function Input({
  label,
  error,
  leftIcon,
  rightIcon,
  containerClassName,
  onFocus,
  onBlur,
  className,
  ...rest
}: InputProps) {
  const [focused, setFocused] = useState(false);

  // Border colour is a small priority ladder: error beats focus beats default.
  const borderClass = error
    ? 'border-danger'
    : focused
      ? 'border-primary'
      : 'border-border';

  return (
    <View className="gap-[6px]">
      {label && (
        <Text variant="caption" color="textMuted" className="ml-[2px]">
          {label}
        </Text>
      )}

      <View
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
          // Merge the body type style so the text matches the rest of the app,
          // then force the themed text colour (RN ignores inherited colour).
          // Kill the default vertical padding so text centres in our fixed height.
          className={[
            'flex-1 py-0 font-inter-regular text-body font-normal text-text placeholder:text-textMuted',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e as any);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e as any);
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
