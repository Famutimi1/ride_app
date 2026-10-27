import { AppMessage } from '@/components/common/AppMessage';
import { useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { AddressIcon } from '@/components/map/AddressIcon';
import { borderWidths, useTheme, type AppColors } from '@/constants/theme';
import { formatNaira } from '@/services/paymentService';
import { getTrip, type Trip } from '@/services/tripService';
import { historyDate } from '@/utils/tripHistory';
import { receiptSummary, type ReceiptTone } from '@/utils/tripReceipt';
import { driverTripPresentation, tripMoney } from '@/utils/driverTripPresentation';
import { useAuthStore } from '@/store/authStore';
import { tripBelongsToRole } from '@/utils/roleAccess';

type ReceiptResult = { key: string; trip: Trip | null; error: string | null };

export function TripReceiptScreen() {
  const router = useRouter();
  const { tripId } = useLocalSearchParams<{ tripId?: string }>();
  const userId = useAuthStore(state => state.session?.user.id);
  const role = useAuthStore(state => state.session?.user.role ?? 'rider');
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<ReceiptResult | null>(null);
  const requestKey = `${userId}:${role}:${tripId}:${revision}`;
  const current = result?.key === requestKey ? result : null;

  useEffect(() => {
    if (!tripId || !userId) return;
    let active = true;
    void getTrip(tripId).then(trip => {
      if (active && useAuthStore.getState().session?.user.id === userId && useAuthStore.getState().session?.user.role === role) {
        const allowed = tripBelongsToRole(trip, userId, role);
        setResult({ key: requestKey, trip: allowed ? trip : null, error: allowed ? null : 'This receipt is unavailable in your current mode. Check your trip history or switch modes from the menu.' });
      }
    }).catch(() => {
      if (active) setResult({ key: requestKey, trip: null, error: 'These trip details could not be loaded.' });
    });
    return () => { active = false; };
  }, [tripId, requestKey, userId, role]);

  if (!tripId) return <Redirect href="/menu" />;
  return <TripReceiptView driver={role === 'driver'} trip={current?.trip ?? null} loading={!current} error={current?.error ?? null} onRetry={() => setRevision(value => value + 1)} onBack={() => router.canGoBack() ? router.back() : router.replace('/menu')} onSupport={() => router.push({ pathname: '/account/[section]', params: { section: 'support' } })} />;
}

interface TripReceiptViewProps {
  driver?: boolean;
  trip: Trip | null; loading: boolean; error: string | null;
  onRetry: () => void; onBack: () => void; onSupport: () => void;
}

const TONE_SURFACE: Record<ReceiptTone, keyof AppColors> = { success: 'successSoft', warning: 'warningSoft', danger: 'dangerSoft', primary: 'primarySoft', textMuted: 'surfaceMuted' };

export function TripReceiptView({ driver = false, trip, loading, error, onRetry, onBack, onSupport }: TripReceiptViewProps) {
  const { colors } = useTheme();
  const summary = trip ? receiptSummary(trip) : null;
  const driverDetails = driver && trip ? driverTripPresentation(trip) : null;
  const courier = trip?.service_type === 'courier';
  const date = trip ? historyDate(trip) : null;
  const dateLabel = date && !Number.isNaN(date.getTime()) ? `${date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })} · ${date.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit', hour12: true })}` : 'Date unavailable';
  const showFare = summary && ['fare', 'estimate', 'recorded'].includes(summary.kind);
  const driverName = trip?.driver_name?.trim() || (trip?.driver_id ? 'Details unavailable' : 'Not assigned');
  const hasDriver = Boolean(trip?.driver_id || trip?.driver_name?.trim());
  const vehicle = [trip?.vehicle_color, trip?.vehicle_make, trip?.vehicle_model].filter(Boolean).join(' ') || 'Not available';

  return <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={[styles.back, { backgroundColor: colors.surfaceMuted }]}><AddressIcon name="back" size={20} /></Pressable>
      <Text variant="bodyMedium" accessibilityRole="header" style={styles.title}>{summary?.title ?? 'Trip details'}</Text>
    </View>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {loading ? <View style={styles.feedback}><ActivityIndicator color={colors.primary} /><Text variant="caption" color="textMuted" accessibilityLiveRegion="polite">Loading trip details…</Text></View> : error || !trip || !summary ? <View style={[styles.feedback, { backgroundColor: colors.dangerSoft, borderRadius: 14 }]}><AppMessage message={error ?? 'Trip not found.'} /><Button label="Retry" size="sm" onPress={onRetry} /></View> : <>
        <Text variant="caption" color="textMuted">{dateLabel}</Text>
        <View style={[styles.summary, { backgroundColor: summary.fulfilled ? colors.primarySoft : colors.surfaceMuted, borderColor: colors.border }]}>
          <View style={[styles.summaryIcon, { borderRightColor: colors.border }]}><RideIcon name={courier ? 'package' : 'car'} size={courier ? 24 : 36} color="primary" /></View>
          <View style={styles.summaryCopy}>
            <View style={[styles.badge, { backgroundColor: colors[TONE_SURFACE[summary.tone]] }]}><Text variant="caption" color={summary.tone}>{summary.statusLabel}</Text></View>
            {driverDetails ? <>
              <Text variant="caption" color="textMuted">{driverDetails.heading}</Text>
              {driverDetails.fulfilled ? <Text variant={driverDetails.earnings === null ? 'button' : 'h2'} color={driverDetails.earnings === null ? 'textMuted' : 'success'}>{driverDetails.earnings === null ? 'Unavailable' : formatNaira(driverDetails.earnings)}</Text> : null}
              <Text variant="caption" color="textMuted">{driverDetails.note}</Text>
            </> : <>
              <Text variant={showFare ? 'caption' : 'bodyMedium'} color={showFare ? 'textMuted' : summary.kind === 'held' ? 'warning' : 'text'}>{summary.heading}</Text>
              {showFare ? <Text variant="bodyMedium">{formatNaira(trip.fare_kobo)}</Text> : null}
              <Text variant="caption" color="textMuted">{summary.note}</Text>
            </>}
          </View>
        </View>

        <View style={[styles.route, { borderColor: colors.border }]}>
          <View style={styles.routeRow}><View style={styles.marker}><AddressIcon name="pickup" size={16} color="primary" /><View style={[styles.connector, { backgroundColor: colors.borderStrong }]} /></View><View style={styles.routeCopy}><Text variant="caption" color="textMuted">Pickup</Text><Text variant="caption" selectable>{trip.pickup_address}</Text></View></View>
          <View style={styles.routeRow}><View style={styles.marker}><AddressIcon name="pin" size={16} color="primary" /></View><View style={styles.routeCopy}><Text variant="caption" color="textMuted">{courier ? 'Delivery address' : 'Destination'}</Text><Text variant="caption" selectable>{trip.dropoff_address}</Text></View></View>
        </View>

        {summary.fulfilled ? <View style={[styles.metrics, { borderColor: colors.border }]}>
          <View style={styles.metric}><Text variant="caption" color="textMuted">Est. distance</Text><Text variant="button">{Number.isFinite(trip.estimated_distance_m) && trip.estimated_distance_m >= 0 ? `${(trip.estimated_distance_m / 1000).toFixed(1)} km` : 'Unavailable'}</Text></View>
          <View style={[styles.metricDivider, { backgroundColor: colors.border }]} />
          <View style={styles.metric}><Text variant="caption" color="textMuted">Est. duration</Text><Text variant="button">{Number.isFinite(trip.estimated_duration_s) && trip.estimated_duration_s >= 0 ? `${Math.ceil(trip.estimated_duration_s / 60)} min` : 'Unavailable'}</Text></View>
        </View> : null}

        {driverDetails?.fulfilled ? <DriverReceiptEarnings trip={trip} /> : null}

        {!summary.fulfilled || (!driver && summary.kind === 'held') ? <View style={[styles.details, { borderColor: colors.border }]}>
          <ReceiptRow label={!driver && summary.kind === 'held' ? 'Reserved amount' : 'Original estimate'} value={formatNaira(trip.fare_kobo)} />
          <ReceiptRow label="Payment method" value={summary.paymentLabel} last />
        </View> : null}

        {courier && trip.courier_details ? <View style={[styles.details, { borderColor: colors.border }]}><ReceiptRow icon="package" label="Package" value={trip.courier_details.description} /><ReceiptRow label="Recipient" value={trip.courier_details.recipientName} last /></View> : null}

        {driver ? <View style={[styles.details, { borderColor: colors.border }]}><ReceiptRow icon="passenger" label="Rider" value={trip.rider_name?.trim() || 'Not available'} last /></View> : <View style={[styles.details, { borderColor: colors.border }]}>
          <ReceiptRow icon="passenger" label="Driver" value={driverName} last={!hasDriver} />
          {hasDriver ? <><ReceiptRow icon="vehicle" label="Vehicle" value={vehicle} /><ReceiptRow icon="plate" label="Plate number" value={trip.plate_number?.trim() || 'Not available'} last /></> : null}
        </View>}
        <View style={[styles.details, { borderColor: colors.border }]}><ReceiptRow icon="receipt" label="Trip ID" value={trip.id} last selectable /></View>
      </>}
    </ScrollView>
    <View style={styles.footer}><Button label="Help & support" variant="ghost" size="sm" fullWidth leftIcon={driver ? <RideIcon name="support" size={16} color="primary" /> : undefined} onPress={onSupport} /></View>
  </SafeAreaView>;
}

function DriverReceiptEarnings({ trip }: { trip: Trip }) {
  const { colors } = useTheme();
  const details = driverTripPresentation(trip);
  const fare = tripMoney(trip.fare_kobo);
  const amount = (value: number | null) => value === null ? 'Unavailable' : formatNaira(value);
  const commission = details.commission === null ? 'Unavailable' : formatNaira(-details.commission);
  const cash = trip.payment_method === 'cash';
  const wallet = trip.payment_method === 'wallet';
  return <>
    <View style={[styles.details, { borderColor: colors.border }]}>
      <Text variant="button" accessibilityRole="header" style={styles.breakdownHeading}>Earnings breakdown</Text>
      <DriverMoneyRow label={trip.service_type === 'courier' ? 'Delivery fare' : 'Trip fare'} value={amount(fare)} />
      <DriverMoneyRow label="Commission" value={commission} tone={details.commission === null || details.commission === 0 ? 'textMuted' : 'danger'} />
      <View style={{ borderTopWidth: borderWidths.divider, borderTopColor: colors.border }}><DriverMoneyRow label="Your earnings" value={amount(details.earnings)} tone={details.earnings === null ? 'textMuted' : 'success'} strong /></View>
    </View>
    <View style={[styles.details, styles.settlement, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
      <View style={styles.settlementHeading}><RideIcon name={trip.payment_method} size={18} color="icon" /><Text variant="button">{details.payment} payment</Text></View>
      {cash ? <>
        <DriverMoneyRow label="Cash fare" value={amount(fare)} />
        <DriverMoneyRow label="Wallet commission" value={details.settled ? commission : 'Not confirmed'} tone={details.settled && details.commission !== null && details.commission > 0 ? 'danger' : 'textMuted'} />
        <Text variant="caption" color="textMuted" style={styles.settlementNote}>{details.settled ? 'Cash fares are collected in person. Commission is charged to your driver wallet.' : 'Cash is paid in person. Wallet commission has not been confirmed.'}</Text>
      </> : wallet ? <>
        <DriverMoneyRow label={details.settled && details.earnings !== null ? 'Credited to your wallet' : 'Wallet credit'} value={details.settled && details.earnings !== null ? `${details.earnings > 0 ? '+' : ''}${formatNaira(details.earnings)}` : 'Not confirmed'} tone={details.settled && details.earnings !== null ? 'success' : 'warning'} />
        <Text variant="caption" color="textMuted" style={styles.settlementNote}>{details.settled && details.earnings !== null ? 'Your earnings are added after commission.' : 'Wallet settlement has not been confirmed.'}</Text>
      </> : <Text variant="caption" color="textMuted" style={styles.settlementNote}>Settlement details are unavailable for this payment method.</Text>}
    </View>
  </>;
}

function DriverMoneyRow({ label, value, tone = 'text', strong = false }: { label: string; value: string; tone?: keyof AppColors; strong?: boolean }) {
  return <View style={styles.moneyRow}><Text variant={strong ? 'button' : 'caption'} style={styles.moneyLabel}>{label}</Text><Text variant="button" color={tone} style={styles.moneyValue}>{value}</Text></View>;
}

function ReceiptRow({ label, value, icon, last = false, selectable = false }: { label: string; value: string; icon?: ComponentProps<typeof RideIcon>['name']; last?: boolean; selectable?: boolean }) {
  const { colors } = useTheme();
  return <View style={[styles.row, { borderBottomWidth: last ? 0 : borderWidths.divider, borderBottomColor: colors.border }]}>
    {icon ? <RideIcon name={icon} size={17} color="icon" /> : null}
    <View style={styles.rowCopy}><Text variant="caption" color="textMuted" style={styles.rowLabel}>{label}</Text><Text variant="caption" selectable={selectable} accessibilityLabel={selectable ? `${label}: ${value}` : undefined} style={styles.rowValue}>{value}</Text></View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  back: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' }, title: { flex: 1 },
  scroll: { flex: 1 }, content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 12 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: borderWidths.divider, borderRadius: 14, padding: 14, minHeight: 112 },
  summaryIcon: { width: 52, alignSelf: 'stretch', alignItems: 'flex-start', justifyContent: 'center', borderRightWidth: borderWidths.divider },
  summaryCopy: { flex: 1, minWidth: 0, gap: 4 }, badge: { alignSelf: 'flex-start', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  route: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 14 }, routeRow: { flexDirection: 'row', gap: 12 }, routeCopy: { flex: 1, minWidth: 0, gap: 4 },
  marker: { width: 16, paddingTop: 2, alignSelf: 'stretch' }, connector: { position: 'absolute', left: 7.5, width: 1, top: 20, bottom: -14 },
  metrics: { borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center' }, metric: { flex: 1, minWidth: 0, padding: 12, gap: 4 }, metricDivider: { width: borderWidths.divider, alignSelf: 'stretch' },
  details: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 12 }, row: { minHeight: 48, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowCopy: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 4 }, rowLabel: { flexBasis: 86, flexGrow: 1 }, rowValue: { flexBasis: 130, flexGrow: 2, flexShrink: 1, textAlign: 'right', minWidth: 0 },
  feedback: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20 }, footer: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  breakdownHeading: { paddingTop: 12, paddingBottom: 4 }, moneyRow: { minHeight: 36, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 12 }, moneyLabel: { flex: 1, minWidth: 0 }, moneyValue: { flexShrink: 1, maxWidth: '48%', textAlign: 'right' },
  settlement: { paddingTop: 12, paddingBottom: 12 }, settlementHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 4 }, settlementNote: { paddingTop: 6 },
});
