import { Pressable, View } from 'react-native';
import { useUiStore, type ThemePreference } from '@/store/uiStore';
import { Text } from './Text';
import { RideIcon } from './RideIcon';

const OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function ThemePreferencePicker() {
  const preference = useUiStore((state) => state.themePreference);
  const setPreference = useUiStore((state) => state.setThemePreference);
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" className="flex-row gap-xs rounded-xl border border-border bg-surface p-xs">
      {OPTIONS.map(({ value, label }) => (
        <Pressable
          key={value}
          accessibilityRole="radio"
          accessibilityLabel={`${label} appearance`}
          accessibilityState={{ checked: preference === value }}
          aria-checked={preference === value}
          onPress={() => setPreference(value)}
          className={`min-h-16 flex-1 items-center justify-center gap-sm rounded-lg border px-xs py-md ${preference === value ? 'border-primary bg-primarySoft' : 'border-transparent bg-surface'}`}
        >
          <RideIcon name={value === 'light' ? 'sun' : value === 'dark' ? 'moon' : 'device'} size={18} color={preference === value ? 'primary' : 'textMuted'} />
          <Text variant="caption" color={preference === value ? 'primary' : 'text'}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
