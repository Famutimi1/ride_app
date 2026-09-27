import { Pressable, View } from 'react-native';
import { useUiStore, type ThemePreference } from '@/store/uiStore';
import { Text } from './Text';

const OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function ThemePreferencePicker() {
  const preference = useUiStore((state) => state.themePreference);
  const setPreference = useUiStore((state) => state.setThemePreference);
  return (
    <View className="mt-sm flex-row flex-wrap gap-sm">
      {OPTIONS.map(({ value, label }) => (
        <Pressable
          key={value}
          accessibilityRole="radio"
          accessibilityLabel={`${label} appearance`}
          accessibilityState={{ checked: preference === value }}
          aria-checked={preference === value}
          onPress={() => setPreference(value)}
          className={`min-h-12 flex-1 items-center justify-center rounded-lg border px-sm py-sm ${preference === value ? 'border-primary bg-primarySoft' : 'border-borderStrong bg-surface'}`}
        >
          <Text variant="button" color={preference === value ? 'primary' : 'text'}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
