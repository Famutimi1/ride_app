import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/constants/theme';
import { safeMessage } from '@/utils/userMessage';
import { RideIcon } from './RideIcon';
import { Text } from './Text';

export type MessageTone = 'error' | 'success' | 'warning' | 'info';
export interface AppMessageProps {
  message: string | null | undefined;
  tone?: MessageTone;
  title?: string;
  actionLabel?: string;
  onAction?: () => void;
  busy?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  className?: string;
}

/** Place near the failed content/action; use compact only below a specific input. */
export function AppMessage({ message, tone = 'error', title, actionLabel, onAction, busy, compact, style, className }: AppMessageProps) {
  const { colors } = useTheme();
  const color = tone === 'error' ? 'danger' : tone === 'info' ? 'primary' : tone;
  const background = tone === 'error' ? 'dangerSoft' : tone === 'info' ? 'primarySoft' : tone === 'success' ? 'successSoft' : 'warningSoft';
  if (!message) return null;
  return <View accessibilityRole={tone === 'error' ? 'alert' : undefined} accessibilityLiveRegion="polite"
    className={className} style={[styles.container, !compact && { backgroundColor: colors[background], borderColor: colors[color], borderLeftWidth: 3 }, compact && styles.compact, style]}>
    <View style={styles.row}>
      <View style={styles.icon}><RideIcon name={tone === 'success' ? 'check' : 'info'} size={16} color={color} /></View>
      <View style={styles.copy}>
        {title ? <Text variant="button" color={color}>{title}</Text> : null}
        <Text variant="caption" color={compact ? color : 'text'}>{safeMessage(message)}</Text>
        {onAction && actionLabel ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onAction} style={styles.action}>
          <Text variant="button" color={color}>{busy ? 'Please wait…' : actionLabel}</Text>
        </Pressable> : null}
      </View>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  container: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, width: '100%' },
  compact: { paddingHorizontal: 2, paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  icon: { paddingTop: 2 }, copy: { flex: 1, minWidth: 0, gap: 2 },
  action: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingRight: 12 },
});
