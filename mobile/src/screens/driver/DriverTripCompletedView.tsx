import { AppMessage } from '@/components/common/AppMessage';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Input, RatingStars, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { AddressIcon } from '@/components/map/AddressIcon';
import { useTheme } from '@/constants/theme';
import { formatNaira } from '@/services/paymentService';
import type { Trip } from '@/services/tripService';

interface Props {
  trip: Trip;
  rating: number;
  comment: string;
  error: string | null;
  busy: boolean;
  onRatingChange: (rating: number) => void;
  onCommentChange: (comment: string) => void;
  onSubmit: () => void;
  onDone: () => void;
}

export function DriverTripCompletedView({ trip, rating, comment, error, busy, onRatingChange, onCommentChange, onSubmit, onDone }: Props) {
  const { colors, typography } = useTheme();
  const returned = trip.status === 'returned';
  const courier = trip.service_type === 'courier';
  const cash = trip.payment_method === 'cash';
  const earnings = trip.driver_earning_kobo;
  const commission = trip.commission_kobo;
  const participant = trip.rider_name?.trim() || (courier ? 'Your sender' : 'Your rider');
  const title = returned ? 'Package returned' : courier ? 'Delivery completed' : 'Trip completed';
  const paymentLabel = cash ? 'Cash fare to collect' : trip.payment_method === 'card' ? 'Card payment' : 'Wallet payment';

  return <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <View style={styles.inline}><RideIcon name="receipt" size={20} color="primary" /><Text variant="bodyMedium">Trip summary</Text></View>
        <View style={[styles.badge, { backgroundColor: colors.successSoft }]}><RideIcon name="check" size={14} color="success" /><Text variant="caption" color="success">{returned ? 'Returned' : 'Completed'}</Text></View>
      </View>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.column}>
          <View style={styles.hero}>
            <View style={[styles.successIcon, { backgroundColor: colors.successSoft }]}><RideIcon name="check" size={28} color="success" /></View>
            <Text variant="h2" accessibilityRole="header">{title}</Text>
            <Text color="textMuted" style={styles.centered}>{returned ? 'The package is back with the sender.' : courier ? 'The package has been handed over.' : 'Thanks for getting your rider there safely.'}</Text>
          </View>

          <View style={[styles.earnings, { backgroundColor: colors.successSoft }]}>
            <Text variant="caption" color="textMuted">Your earnings</Text>
            <Text variant="h1" color="success" style={typography.h1}>{earnings == null ? 'Pending' : formatNaira(earnings)}</Text>
            <Text variant="caption" color="textMuted" style={styles.centered}>{earnings == null ? 'Final earnings will appear after settlement is confirmed.' : 'After Rakky Ride commission'}</Text>
          </View>

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text variant="bodyMedium" accessibilityRole="header">Fare breakdown</Text>
            <View style={styles.breakdownRow}><Text color="textMuted">Total fare</Text><Text variant="bodyMedium">{formatNaira(trip.fare_kobo)}</Text></View>
            <View style={styles.breakdownRow}><Text color="textMuted" style={styles.flex}>Rakky Ride commission</Text><Text variant="bodyMedium" color={commission == null ? 'textMuted' : 'danger'}>{commission == null ? 'Pending' : `${commission > 0 ? '−' : ''}${formatNaira(commission)}`}</Text></View>
            <View style={[styles.payment, { borderTopColor: colors.border }]}>
              <View style={[styles.paymentIcon, { backgroundColor: colors.surfaceMuted }]}><RideIcon name={cash ? 'cash' : trip.payment_method === 'card' ? 'card' : 'wallet'} color="primary" size={22} /></View>
              <View style={styles.flex}><Text variant="bodyMedium">{paymentLabel}</Text><Text variant="caption" color="textMuted">{cash ? `Collect ${formatNaira(trip.fare_kobo)} directly from the rider.` : 'The rider pays through the app.'}</Text></View>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.breakdownRow}><Text variant="bodyMedium" accessibilityRole="header">{courier ? 'Delivery details' : 'Trip details'}</Text><Text variant="caption" color="textMuted">#{trip.id.slice(-8).toUpperCase()}</Text></View>
            <RouteStop label="Pickup" address={trip.pickup_address} pickup />
            <View style={[styles.connector, { backgroundColor: colors.borderStrong }]} />
            <RouteStop label="Destination" address={trip.dropoff_address} />
            {returned ? <View style={[styles.returnNote, { backgroundColor: colors.surfaceMuted }]}><RideIcon name="swap" color="primary" size={18} /><Text variant="caption" color="textMuted" style={styles.flex}>Returned to pickup. The original delivery fare applies, with no extra return fee.</Text></View> : null}
          </View>

          {!returned ? <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.inline}>
              <View style={[styles.avatar, { backgroundColor: colors.successSoft }]}><Text variant="h2" color="success">{participant.charAt(0).toUpperCase()}</Text></View>
              <View style={styles.flex}><Text variant="bodyMedium">{courier ? 'Rate the sender' : 'Rate your rider'}</Text><Text variant="caption" color="textMuted">{participant}</Text></View>
              <Text variant="caption" color="textMuted">Optional</Text>
            </View>
            <View style={styles.stars}><RatingStars value={rating} size={36} interactive={!busy} onChange={onRatingChange} /></View>
            <Input value={comment} onChangeText={onCommentChange} editable={!busy} placeholder="Add a comment (optional)" maxLength={500} multiline numberOfLines={2} textAlignVertical="top" />
          </View> : null}
        </View>
      </ScrollView>
      <View style={[styles.footer, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <View style={styles.footerContent}>
          {error ? <AppMessage message={error} /> : null}
          {!returned ? <Button label="Submit rating & continue" fullWidth loading={busy} onPress={onSubmit} /> : null}
          <Button label="Back to driver home" variant={returned ? 'primary' : 'ghost'} fullWidth disabled={busy} onPress={onDone} rightIcon={returned ? <RideIcon name="chevron" color="textInverse" size={18} /> : undefined} />
        </View>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function RouteStop({ label, address, pickup = false }: { label: string; address: string; pickup?: boolean }) {
  return <View style={styles.routeStop}><AddressIcon name={pickup ? 'pickup' : 'pin'} color={pickup ? 'mapPickup' : 'mapDropoff'} size={18} /><View style={styles.flex}><Text variant="caption" color="textMuted">{label}</Text><Text variant="bodyMedium">{address}</Text></View></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, flex: { flex: 1, minWidth: 0 }, centered: { textAlign: 'center' },
  header: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  inline: { flexDirection: 'row', gap: 12, alignItems: 'center' }, badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 }, column: { width: '100%', maxWidth: 600, alignSelf: 'center', gap: 16 },
  hero: { alignItems: 'center', gap: 8, paddingBottom: 4 }, successIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  earnings: { alignItems: 'center', gap: 8, padding: 20, borderRadius: 16 },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 16 }, breakdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  payment: { borderTopWidth: 1, paddingTop: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }, paymentIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  routeStop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, connector: { width: 1, height: 16, marginLeft: 8, marginVertical: -12 },
  returnNote: { borderRadius: 8, padding: 12, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  avatar: { height: 48, width: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' }, stars: { alignItems: 'center' },
  footer: { borderTopWidth: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 }, footerContent: { width: '100%', maxWidth: 600, alignSelf: 'center', gap: 4 },
});
