/**
 * ListRow — one line in a settings/stats list (the rows in the mockup's Profile
 * "Stats" section and the Notifications toggles).
 *
 * Layout, left → right:
 *   [optional icon in a tinted circle]  [label (takes the slack)]  [value OR right node]
 *
 * `value` is the simple case (a bit of text on the right, like "$120.00").
 * `right` overrides it when you need a real control there instead (a <Toggle>, a
 * chevron, etc.). Pass `onPress` to make the whole row tappable.
 *
 * Usage:
 *   <ListRow icon={<Text>💰</Text>} label="Wallet balance" value="$120.00" />
 *   <ListRow label="Push notifications" right={<Toggle value={on} onValueChange={setOn} />} />
 */
import { Pressable, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/constants/theme';

import { Text } from './Text';

export interface ListRowProps {
  label: string;
  /** Simple right-hand text (e.g. a money value). Ignored if `right` is given. */
  value?: string;
  /** Rendered inside a tinted circle on the left when provided. */
  icon?: React.ReactNode;
  /** A custom right-hand node (a Toggle, chevron…) — wins over `value`. */
  right?: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
}

export function ListRow({ label, value, icon, right, onPress, style }: ListRowProps) {
  const theme = useTheme();

  const content = (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingVertical: theme.spacing.md,
        },
        style,
      ]}
    >
      {icon != null ? (
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: theme.radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.primarySoft,
          }}
        >
          {icon}
        </View>
      ) : null}

      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>

      {right ?? (value != null ? <Text variant="bodyMedium">{value}</Text> : null)}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
        {content}
      </Pressable>
    );
  }
  return content;
}
