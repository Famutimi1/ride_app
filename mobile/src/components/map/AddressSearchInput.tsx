import type { ReactNode } from 'react';
import { ActivityIndicator, TextInput, View } from 'react-native';
import { Text } from '@/components/common';
import { useTheme } from '@/constants/theme';

interface AddressSearchInputProps {
  active?: boolean;
  label: string;
  placeholder: string;
  value: string;
  loading?: boolean;
  rightAccessory?: ReactNode;
  onChangeText: (value: string) => void;
  onFocus: () => void;
}

/** Shared, controlled address field. Suggestions are rendered by its parent so
 * pickup and destination use one list below the combined address container. */
export function AddressSearchInput({ active = false, label, placeholder, value, loading = false, rightAccessory, onChangeText, onFocus }: AddressSearchInputProps) {
  const { colors } = useTheme();
  return <View>
    <View className="h-8 flex-row items-center justify-between pl-xl">
      <Text variant="caption" color="textMuted">{label}</Text>
      {rightAccessory}
    </View>
    <View className={`h-11 flex-row items-center rounded-lg border bg-surface pl-xl pr-md ${active ? 'border-primary' : 'border-borderStrong'}`}>
      <TextInput value={value} placeholder={placeholder} placeholderTextColor={colors.textMuted} selectionColor={colors.primary}
        onFocus={onFocus} onChangeText={onChangeText} className="flex-1 p-0 font-inter-medium text-body text-text outline-none" />
      {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
    </View>
  </View>;
}
