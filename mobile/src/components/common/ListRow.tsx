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
import { Pressable, View } from 'react-native';

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
  className?: string;
}

export function ListRow({ label, value, icon, right, onPress, className }: ListRowProps) {
  const content = (
    <View
      className={['flex-row items-center gap-md py-md', className].filter(Boolean).join(' ')}
    >
      {icon != null ? (
        <View className="h-9 w-9 items-center justify-center rounded-full bg-primarySoft">
          {icon}
        </View>
      ) : null}

      <Text variant="body" className="flex-1">
        {label}
      </Text>

      {right ?? (value != null ? <Text variant="bodyMedium">{value}</Text> : null)}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} className="active:opacity-60">
        {content}
      </Pressable>
    );
  }
  return content;
}
