/**
 * Toggle — a themed on/off switch (the pill switches in the mockup's Notifications
 * screen: "Push notifications" on, "Tips" off).
 *
 * It's a thin wrapper over React Native's <Switch> that pipes our semantic colour
 * tokens into the platform switch, so it turns brand blue when on and greys out its
 * track when off — in both light and dark mode, with no hard-coded hex.
 *
 * Usage:
 *   const [on, setOn] = useState(true);
 *   <Toggle value={on} onValueChange={setOn} />
 */
import { Switch } from 'react-native';

import { useTheme } from '@/constants/theme';

export interface ToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ value, onValueChange, disabled }: ToggleProps) {
  const theme = useTheme();
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      // track = the pill behind the thumb: grey when off, brand blue when on.
      trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primary }}
      // thumb = the moving knob. Keep it on the surface colour so it reads in both themes.
      thumbColor={theme.colors.surface}
      // iOS shows this colour behind the track before the value flips.
      ios_backgroundColor={theme.colors.borderStrong}
    />
  );
}
