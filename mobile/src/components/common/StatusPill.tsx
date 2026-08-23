/**
 * StatusPill — the small rounded status labels from the mockup (e.g. "Online",
 * "Searching…", "Completed", "Cancelled").
 *
 * A pill = a soft tinted background + a matching solid-colour label, so it reads
 * clearly on both light and dark surfaces. Pick a `tone` by meaning:
 *   • success  — online, paid, completed        (green)
 *   • primary  — in-progress, active            (blue)
 *   • warning  — searching, pending             (amber)
 *   • danger   — cancelled, failed, offline      (red)
 *   • neutral  — muted / informational          (grey)
 *
 * Optional `dot` renders a small filled circle before the label — handy for the
 * driver "online" indicator.
 *
 * Usage:  <StatusPill tone="success" label="Online" dot />
 */
import { StyleSheet, View } from 'react-native';

import type { AppColors } from '@/constants/colors';
import { useTheme } from '@/constants/theme';

import { Text } from './Text';

type PillTone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

export interface StatusPillProps {
  label: string;
  tone?: PillTone;
  dot?: boolean;
}

// Maps each tone to its (soft background token, solid foreground token).
const TONE_TOKENS: Record<PillTone, { bg: keyof AppColors; fg: keyof AppColors }> = {
  primary: { bg: 'primarySoft', fg: 'primary' },
  success: { bg: 'successSoft', fg: 'success' },
  warning: { bg: 'warningSoft', fg: 'warning' },
  danger: { bg: 'dangerSoft', fg: 'danger' },
  neutral: { bg: 'surfaceMuted', fg: 'textMuted' },
};

export function StatusPill({ label, tone = 'neutral', dot = false }: StatusPillProps) {
  const theme = useTheme();
  const { bg, fg } = TONE_TOKENS[tone];

  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: theme.colors[bg], borderRadius: theme.radius.full },
      ]}
    >
      {dot && (
        <View style={[styles.dot, { backgroundColor: theme.colors[fg] }]} />
      )}
      <Text variant="caption" color={fg} style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start', // hug the content instead of stretching
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    // Slightly heavier than plain caption so the status reads as a label.
    fontWeight: '500',
  },
});
