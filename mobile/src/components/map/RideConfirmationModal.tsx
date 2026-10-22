import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { nativeWindTheme, radius, spacing, useTheme } from '@/constants/theme';
import { formatNaira } from '@/services/paymentService';
import { AddressIcon } from './AddressIcon';

interface RideConfirmationModalProps {
  visible: boolean;
  rideName: string;
  fareKobo: number | null;
  paymentName: string;
  pickupAddress: string;
  dropoffAddress: string;
  onClose: () => void;
  onConfirm: () => void;
  scheduledAt?: string;
  loading?: boolean;
}

export function RideConfirmationModal({ visible, rideName, fareKobo, paymentName, pickupAddress, dropoffAddress, onClose, onConfirm, scheduledAt, loading = false }: RideConfirmationModalProps) {
  const { colors, scheme } = useTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const fareLabel = fareKobo === null ? 'Calculating…' : formatNaira(fareKobo);
  const cashPayment = paymentName.toLowerCase() === 'cash';
  const close = () => { if (!loading) onClose(); };
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
    <SafeAreaView edges={['top', 'bottom']} style={[styles.overlay, nativeWindTheme[scheme], { backgroundColor: colors.overlay }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss ride confirmation" disabled={loading} onPress={close} style={StyleSheet.absoluteFill} />
      <View accessibilityViewIsModal style={[styles.card, { backgroundColor: colors.surface, maxHeight: Math.max(0, height - insets.top - insets.bottom - spacing.lg * 2) }]}>
        <View style={styles.header}>
          <View style={styles.copy}><Text variant="bodyMedium" accessibilityRole="header">{scheduledAt ? 'Confirm scheduled ride' : 'Confirm your ride'}</Text><Text variant="caption" color="textMuted" style={styles.caption}>Check your trip details.</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close ride confirmation" accessibilityState={{ disabled: loading }} disabled={loading} onPress={close} style={[styles.close, { backgroundColor: colors.surfaceMuted, opacity: loading ? 0.5 : 1 }]}><RideIcon name="close" size={18} /></Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator>
          <View style={[styles.rideSummary, { backgroundColor: colors.primarySoft }]}>
            <View style={[styles.car, { backgroundColor: colors.surface }]}><RideIcon name="car" size={28} color="primary" /></View>
            <Text variant="button" style={styles.copy}>{rideName}</Text><Text variant="bodyMedium" accessibilityLiveRegion="polite">{fareLabel}</Text>
          </View>
          {scheduledAt ? <View style={styles.scheduled}><RideIcon name="calendar" size={16} color="primary" /><Text variant="caption" style={styles.copy}>{new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(scheduledAt))} · WAT</Text></View> : null}

          <View style={[styles.route, { borderColor: colors.border }]}>
            <LocationSummary kind="pickup" label="Pickup" address={pickupAddress} />
            <View style={[styles.connector, { borderColor: colors.borderStrong }]} />
            <LocationSummary kind="dropoff" label="Drop-off" address={dropoffAddress} />
          </View>

          <View style={styles.payment}>
            <RideIcon name={cashPayment ? 'cash' : 'wallet'} size={19} color="primary" />
            <View style={styles.copy}><Text variant="button">{paymentName}</Text><Text variant="caption" color="textMuted" style={styles.caption}>{cashPayment ? 'Pay after your trip' : 'Pay with your wallet balance'}</Text></View>
          </View>
          <View style={[styles.safety, { backgroundColor: colors.primarySoft }]}><RideIcon name="safety" size={16} color="primary" /><Text variant="caption" color="primary" style={styles.copy}>Trip and driver location are tracked for safety.</Text></View>
          {scheduledAt ? <Text variant="caption" color="textMuted">We start searching about 5 minutes before pickup. Your booking does not guarantee a driver.</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          <Button label={`${scheduledAt ? 'Schedule' : 'Confirm'} ${rideName} · ${fareLabel}`} size="sm" className="min-h-12" fullWidth loading={loading} disabled={fareKobo === null || loading} onPress={onConfirm} />
          {!scheduledAt ? <Text variant="caption" color="textMuted" style={styles.helper}>We’ll look for a driver after you confirm.</Text> : null}
        </View>
      </View>
    </SafeAreaView>
  </Modal>;
}

function LocationSummary({ kind, label, address }: { kind: 'pickup' | 'dropoff'; label: string; address: string }) {
  return <View style={styles.location}><AddressIcon name={kind === 'pickup' ? 'pickup' : 'pin'} size={16} color={kind === 'pickup' ? 'mapPickup' : 'mapDropoff'} /><View style={styles.copy}><Text variant="caption" color="textMuted">{label}</Text><Text variant="caption">{address}</Text></View></View>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: { width: '100%', maxWidth: 380, borderRadius: 16, overflow: 'hidden' },
  copy: { flex: 1, minWidth: 0 }, caption: { marginTop: spacing.xs },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.lg, paddingBottom: spacing.md },
  close: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 0, flexShrink: 1 }, content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  rideSummary: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.lg },
  car: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  scheduled: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  route: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.md },
  location: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  connector: { height: 12, marginLeft: 7, marginVertical: spacing.xs, borderLeftWidth: 1, borderStyle: 'dashed' },
  payment: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  safety: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, padding: spacing.sm },
  footer: { padding: spacing.lg, gap: spacing.sm }, helper: { textAlign: 'center' },
});
