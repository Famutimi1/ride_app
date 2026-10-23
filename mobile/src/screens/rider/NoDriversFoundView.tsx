import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { AddressIcon } from '@/components/map/AddressIcon';
import { borderWidths, radius, spacing, useTheme } from '@/constants/theme';

interface NoDriversFoundViewProps {
  pickupAddress: string;
  courier: boolean;
  onRetry: () => void;
  onChangePickup: () => void;
  onHome: () => void;
}

/** A terminal search result. Actions return to review; they never request a trip. */
export function NoDriversFoundView({ pickupAddress, courier, onRetry, onChangePickup, onHome }: NoDriversFoundViewProps) {
  const { colors } = useTheme();
  return <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to home" onPress={onHome} style={[styles.back, { backgroundColor: colors.surfaceMuted }]}><AddressIcon name="back" size={19} /></Pressable>
      <Text variant="bodyMedium">Driver availability</Text>
    </View>
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.message}>
        <View style={[styles.illustration, { borderColor: colors.border }]}>
          <View style={[styles.car, { backgroundColor: colors.primarySoft }]}><RideIcon name="car" size={42} color="primary" /></View>
          <View style={[styles.unavailable, { backgroundColor: colors.warningSoft, borderColor: colors.background }]}><RideIcon name="minus" size={16} color="warning" /></View>
        </View>
        <View accessibilityLiveRegion="polite" role="status" style={styles.copy}>
          <Text variant="bodyMedium" accessibilityRole="header" style={styles.centered}>{courier ? 'No delivery drivers nearby' : 'No drivers nearby right now'}</Text>
          <Text variant="caption" color="textMuted" style={styles.centered}>Try again shortly, or choose another pickup point.</Text>
        </View>
        <View style={[styles.pickup, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <View style={[styles.pin, { backgroundColor: colors.surfaceMuted }]}><AddressIcon name="pickup" size={17} color="primary" /></View>
          <View style={styles.address}><Text variant="caption" color="textMuted">Your pickup</Text><Text variant="caption" numberOfLines={2}>{pickupAddress}</Text></View>
        </View>
      </View>
    </ScrollView>
    <View style={styles.footer}>
      <Button label="Try again" size="sm" className="min-h-12" fullWidth leftIcon={<RideIcon name="refresh" size={16} color="textInverse" />} onPress={onRetry} />
      <Button label="Change pickup" size="sm" className="min-h-12" variant="outline" fullWidth leftIcon={<RideIcon name="location" size={16} color="primary" />} onPress={onChangePickup} />
      <Text variant="caption" color="textMuted" style={styles.helper}>Review your route before requesting again.</Text>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  back: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing['2xl'] },
  message: { width: '100%', maxWidth: 380, alignSelf: 'center', alignItems: 'center', gap: spacing.xl },
  illustration: { width: 104, height: 104, borderRadius: radius.full, borderWidth: borderWidths.divider, alignItems: 'center', justifyContent: 'center' },
  car: { width: 76, height: 76, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  unavailable: { position: 'absolute', right: 0, bottom: 3, width: 30, height: 30, borderRadius: radius.full, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  copy: { gap: spacing.sm, maxWidth: 300 }, centered: { textAlign: 'center' },
  pickup: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: borderWidths.divider, borderRadius: radius.lg, padding: spacing.md },
  pin: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' }, address: { flex: 1, minWidth: 0, gap: spacing.xs },
  footer: { width: '100%', maxWidth: 420, alignSelf: 'center', paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  helper: { textAlign: 'center', marginTop: spacing.xs },
});
