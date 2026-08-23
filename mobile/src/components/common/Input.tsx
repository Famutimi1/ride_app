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
import {
  type NativeSyntheticEvent,
  StyleSheet,
  TextInput,
  type TextInputFocusEventData,
  type TextInputProps,
  View,
} from 'react-native';

import { useTheme } from '@/constants/theme';

import { Text } from './Text';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export function Input({
  label,
  error,
  leftIcon,
  rightIcon,
  onFocus,
  onBlur,
  style,
  ...rest
}: InputProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  // Border colour is a small priority ladder: error beats focus beats default.
  const borderColor = error
    ? theme.colors.danger
    : focused
      ? theme.colors.primary
      : theme.colors.border;

  return (
    <View style={styles.wrapper}>
      {label && (
        <Text variant="caption" color="textMuted" style={styles.label}>
          {label}
        </Text>
      )}

      <View
        style={[
          styles.field,
          {
            borderColor,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.surfaceMuted,
            paddingHorizontal: theme.spacing.lg,
          },
        ]}
      >
        {leftIcon}
        <TextInput
          placeholderTextColor={theme.colors.textMuted}
          // Merge the body type style so the text matches the rest of the app,
          // then force the themed text colour (RN ignores inherited colour).
          style={[
            theme.typography.body,
            styles.input,
            { color: theme.colors.text },
            style,
          ]}
          onFocus={(e: NativeSyntheticEvent<TextInputFocusEventData>) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e: NativeSyntheticEvent<TextInputFocusEventData>) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        {rightIcon}
      </View>

      {error && (
        <Text variant="caption" color="danger" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 6,
  },
  label: {
    marginLeft: 2,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 52,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    // Kill the default vertical padding so text centres in our fixed height.
    paddingVertical: 0,
  },
  error: {
    marginLeft: 2,
  },
});
