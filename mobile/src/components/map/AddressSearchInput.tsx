import { useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '@/components/common';
import { useTheme } from '@/constants/theme';
import { AddressIcon } from './AddressIcon';

interface AddressSearchInputProps {
  active?: boolean;
  kind: 'pickup' | 'dropoff';
  label: string;
  placeholder: string;
  value: string;
  loading?: boolean;
  onChangeText: (value: string) => void;
  onFocus: () => void;
}

/** The complete row is tappable, including its From/To label. */
export function AddressSearchInput({ active = false, kind, label, placeholder, value, loading = false, onChangeText, onFocus }: AddressSearchInputProps) {
  const { colors } = useTheme();
  const input = useRef<TextInput>(null);
  return <Pressable accessible={false} onPress={() => input.current?.focus()}
    style={[styles.field, { backgroundColor: active ? colors.surface : colors.surfaceMuted, borderColor: active ? colors.primary : colors.border }]}
  >
    <AddressIcon name={kind === 'pickup' ? 'pickup' : 'pin'} color={kind === 'pickup' ? 'mapPickup' : 'mapDropoff'} />
    <View style={styles.copy}>
      <Text variant="caption" color="textMuted" onPress={() => input.current?.focus()}>{label}</Text>
      <TextInput ref={input} accessibilityLabel={label} value={value} placeholder={placeholder} placeholderTextColor={colors.textMuted} selectionColor={colors.primary}
        onFocus={onFocus} onChangeText={onChangeText} autoCapitalize="words" autoCorrect={false}
        className="p-0 font-inter-medium text-button text-text outline-none" style={styles.input} />
    </View>
    {loading ? <ActivityIndicator size="small" color={colors.primary} /> : active && value ? (
      <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${label.toLowerCase()} address`} onPress={() => { onChangeText(''); input.current?.focus(); }} style={styles.clear}>
        <AddressIcon name="close" size={16} color="textMuted" />
      </Pressable>
    ) : null}
  </Pressable>;
}

const styles = StyleSheet.create({
  field: { minHeight: 64, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 14, paddingRight: 32, paddingVertical: 6 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  input: { minHeight: 24, width: '100%' },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
