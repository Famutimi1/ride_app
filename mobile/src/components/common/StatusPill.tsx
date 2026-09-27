/**
 * StatusPill — the small rounded status labels from the mockup (e.g. "Online",
 * "Searching…", "Completed", "Cancelled").
 *
 * A pill = a soft tinted background + a matching solid-colour label, so it reads
 * clearly on both light and dark surfaces. Pick a `tone` by meaning:
 *   • success  — online, paid, completed        (green)
 *   • primary  — in-progress, active            (brand green)
 *   • warning  — searching, pending             (amber)
 *   • danger   — cancelled, failed, offline      (red)
 *   • neutral  — muted / informational          (grey)
 *
 * Optional `dot` renders a small filled circle before the label — handy for the
 * driver "online" indicator.
 *
 * Usage:  <StatusPill tone="success" label="Online" dot />
 */
import { View } from 'react-native';

import type { AppColors } from '@/constants/colors';

import { Text } from './Text';

type PillTone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

export interface StatusPillProps {
  label: string;
  tone?: PillTone;
  dot?: boolean;
}

// Maps each tone to its (soft background token, solid foreground token).
const TONE_TOKENS: Record<
  PillTone,
  { fg: keyof AppColors; bgClass: string; dotClass: string }
> = {
  primary: {
    fg: 'primary',
    bgClass: 'bg-primarySoft',
    dotClass: 'bg-primary',
  },
  success: {
    fg: 'success',
    bgClass: 'bg-successSoft',
    dotClass: 'bg-success',
  },
  warning: {
    fg: 'warning',
    bgClass: 'bg-warningSoft',
    dotClass: 'bg-warning',
  },
  danger: {
    fg: 'danger',
    bgClass: 'bg-dangerSoft',
    dotClass: 'bg-danger',
  },
  neutral: {
    fg: 'textMuted',
    bgClass: 'bg-surfaceMuted',
    dotClass: 'bg-textMuted',
  },
};

export function StatusPill({ label, tone = 'neutral', dot = false }: StatusPillProps) {
  const { fg, bgClass, dotClass } = TONE_TOKENS[tone];

  // hug the content instead of stretching
  return (
    <View
      className={`flex-row items-center self-start gap-[6px] rounded-full px-2.5 py-xs ${bgClass}`}
    >
      {dot && <View className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />}
      <Text
        variant="caption"
        color={fg}
        // Slightly heavier than plain caption so the status reads as a label.
        className="!font-inter-medium !font-medium"
      >
        {label}
      </Text>
    </View>
  );
}
