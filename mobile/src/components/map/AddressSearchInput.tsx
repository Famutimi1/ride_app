import { ActivityIndicator, TextInput, View } from 'react-native';
import { Text } from '@/components/common';
import { useTheme } from '@/constants/theme';

interface AddressSearchInputProps {
  active?: boolean;
  label: string;
  placeholder: string;
  value: string;
  loading?: boolean;
  onChangeText: (value: string) => void;
  onFocus: () => void;
}

/** Shared, controlled address field. Suggestions are rendered by its parent so
 * pickup and destination use one list below the combined address container. */
export function AddressSearchInput({ active = false, label, placeholder, value, loading = false, onChangeText, onFocus }: AddressSearchInputProps) {
  const { colors } = useTheme();
  return <View>
    <Text variant="caption" color="textMuted" className="ml-xl">{label}</Text>
    <View className={`mt-xs h-11 flex-row items-center rounded-lg border bg-surface pl-xl pr-md ${active ? 'border-primary' : 'border-borderStrong'}`}>
      <TextInput value={value} placeholder={placeholder} placeholderTextColor={colors.textMuted} selectionColor={colors.primary}
        onFocus={onFocus} onChangeText={onChangeText} className="flex-1 p-0 font-inter-medium text-body text-text outline-none" />
      {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
    </View>
  </View>;
}
