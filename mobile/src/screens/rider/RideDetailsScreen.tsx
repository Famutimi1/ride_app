import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { AppMap, RideConfirmationModal, type AppMapMarker } from '@/components/map';
import { AddressIcon } from '@/components/map/AddressIcon';
import { nativeWindTheme, useTheme } from '@/constants/theme';
import { useTripQuote } from '@/hooks/useTripQuote';
import { apiErrorMessage } from '@/lib/apiClient';
import { useMapStore } from '@/store/mapStore';
import { useTripStore } from '@/store/tripStore';
import { TripQuoteError } from '@/services/tripService';
import { useWalletStore } from '@/store/walletStore';
import { formatNaira } from '@/services/paymentService';
import { formatScheduledTime, SCHEDULE_MAX_LEAD_MS, SCHEDULE_MIN_LEAD_MS } from '@/utils/scheduleTime';

type PaymentId = 'cash' | 'wallet';

const RIDE = { name: 'Ride', description: 'Everyday rides', seats: 4 } as const;

const PAYMENT_OPTIONS = [
  { id: 'cash' as const, name: 'Cash', detail: 'Pay after your trip', icon: 'cash' },
  { id: 'wallet' as const, name: 'Rakky Ride wallet', detail: 'Pay with your wallet balance', icon: 'wallet' },
] as const;

export function RideDetailsScreen() {
  const router = useRouter();
  const { scheduledAt } = useLocalSearchParams<{ scheduledAt?: string }>();
  const scheduledTime = scheduledAt ? new Date(scheduledAt).getTime() : null;
  const theme = useTheme();
  const { colors } = theme;
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const sheetHeight = Math.min(548 + insets.bottom, height * 0.72);
  const pickup = useMapStore((state) => state.pickupLocation);
  const dropoff = useMapStore((state) => state.dropoffLocation);
  const route = useMapStore((state) => state.routeCoordinates);
  const region = useMapStore((state) => state.cameraRegion);
  const { estimate, error: quoteError, fareChange, clearFareChange, retry: retryQuote, refresh: refreshQuote, ensureFresh } = useTripQuote(pickup, dropoff);
  const [payment, setPayment] = useState<PaymentId>('cash');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [confirmationFor, setConfirmationFor] = useState<{ pickup: typeof pickup; dropoff: typeof dropoff } | null>(null);
  const confirmationOpen = !!estimate && !fareChange && confirmationFor?.pickup === pickup && confirmationFor?.dropoff === dropoff;
  const setConfirmationOpen = (open: boolean) => setConfirmationFor(open ? { pickup, dropoff } : null);
  const [submitting, setSubmitting] = useState(false);
  const submissionInFlight = useRef(false);
  const requestTrip=useTripStore(state=>state.request),requesting=useTripStore(state=>state.loading);
  const walletKobo=useWalletStore(state=>state.walletKobo),refreshWallet=useWalletStore(state=>state.refresh);
  const walletLoading = useWalletStore(state => state.loading);
  const walletError = useWalletStore(state => state.error);
  const requestKey=useRef<string|null>(null);

  useEffect(()=>{void refreshWallet();},[refreshWallet]);

  const confirmRequest = async () => {
    if (!pickup || !dropoff || !estimate || requesting || submissionInFlight.current) return;
    if (scheduledAt && (!scheduledTime || scheduledTime < Date.now() + SCHEDULE_MIN_LEAD_MS || scheduledTime > Date.now() + SCHEDULE_MAX_LEAD_MS)) {
      setConfirmationOpen(false);
      Alert.alert('Choose a new pickup time', 'Scheduled pickup must be 30 minutes to 7 days from now.');
      router.replace('/schedule');
      return;
    }
    submissionInFlight.current = true;
    setSubmitting(true);
    const approvedFareKobo = estimate.fareKobo;
    requestKey.current ??= `trip-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      let quote = await ensureFresh();
      if (quote.fareKobo !== approvedFareKobo) { setConfirmationOpen(false); return; }
      if (!scheduledAt && payment === 'wallet' && walletKobo < quote.fareKobo) {
        setConfirmationOpen(false);
        router.push({ pathname: '/account/[section]', params: { section: 'top-up', target: 'wallet' } });
        return;
      }
      setConfirmationOpen(false);
      const send = (quoteId: string) => requestTrip({ pickup, dropoff, quoteId, paymentMethod: payment, ...(scheduledAt ? { scheduledAt } : {}) }, requestKey.current!);
      let trip;
      try { trip = await send(quote.quoteId); }
      catch (reason) {
        if (!(reason instanceof TripQuoteError)) throw reason;
        quote = await refreshQuote();
        if (quote.fareKobo !== approvedFareKobo) return;
        trip = await send(quote.quoteId);
      }
      void refreshWallet();
      router.replace(trip.status === 'scheduled' ? '/schedule' : '/ongoing-trip');
    } catch (reason) {
      Alert.alert(reason instanceof TripQuoteError ? 'Review the latest fare' : 'Could not request ride', apiErrorMessage(reason));
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  };

  const markers = useMemo<AppMapMarker[]>(() => [
    ...(pickup ? [{ ...pickup, id: 'pickup', kind: 'pickup' as const }] : []),
    ...(dropoff ? [{ ...dropoff, id: 'dropoff', kind: 'dropoff' as const }] : []),
  ], [dropoff, pickup]);
  const fareLabel = estimate ? formatNaira(estimate.fareKobo) : quoteError ? 'Fare unavailable' : 'Calculating…';
  const selectedPayment = PAYMENT_OPTIONS.find((item) => item.id === payment) ?? PAYMENT_OPTIONS[0];
  const goBack = () => router.canGoBack() ? router.back() : router.replace({ pathname: '/ride-selection', params: scheduledAt ? { scheduledAt } : {} });

  const walletUnavailable = !scheduledAt && (walletLoading || !!walletError);
  const walletBalanceLabel = walletLoading ? 'Updating balance…' : walletError ? 'Balance unavailable' : `Balance: ${formatNaira(walletKobo)}`;
  const quotePendingLabel = quoteError ? 'Unavailable' : 'Calculating…';
  const choosePayment = (id: PaymentId) => {
    if (id === 'wallet' && walletUnavailable) return;
    if (id === 'wallet' && !scheduledAt && walletKobo < (estimate?.fareKobo ?? 0)) {
      setPaymentOpen(false);
      router.push({ pathname: '/account/[section]', params: { section: 'top-up', target: 'wallet' } });
      return;
    }
    setPayment(id);
    setPaymentOpen(false);
  };

  return <View style={[styles.screen, { backgroundColor: colors.surfaceMuted }]}>
    <View style={[StyleSheet.absoluteFill, { bottom: sheetHeight }]}>
      <AppMap region={region} markers={markers} polyline={route} fitRouteOnChange mapPadding={{ top: insets.top + 60, right: 24, bottom: 28, left: 24 }} />
    </View>
    <SafeAreaView edges={['top']} style={styles.mapControls}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to ride selection" onPress={goBack} style={[styles.backButton, { backgroundColor: colors.surface }]}><AddressIcon name="back" size={20} /></Pressable>
    </SafeAreaView>

    <View style={[styles.sheet, { height: sheetHeight, backgroundColor: colors.surface }]}>
      <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text variant="bodyMedium" style={styles.title}>Ride details</Text>
        <View style={[styles.rideSummary, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
          <RideIcon name="car" size={42} color="primary" />
          <View style={styles.rideCopy}>
            <View style={styles.rideNameRow}>
              <Text variant="button">{RIDE.name}</Text>
              <View style={[styles.recommended, { backgroundColor: colors.primary }]}><Text variant="caption" color="textInverse">Recommended</Text></View>
            </View>
            <Text variant="caption" color="textMuted">{RIDE.description}</Text>
          </View>
          <View style={styles.fareCopy}><Text variant="button">{fareLabel}</Text><Text variant="caption" color="textMuted">Quoted fare</Text></View>
        </View>
        {!pickup || !dropoff ? <Text variant="caption" color="textMuted" style={styles.notice}>Choose pickup and destination to see your fare.</Text> : null}
        {quoteError ? <Pressable accessibilityRole="button" onPress={retryQuote} style={styles.retry}><Text variant="caption" color="danger">{quoteError} · Retry fare</Text></Pressable> : null}
        {fareChange ? <Text accessibilityRole="alert" variant="caption" color="danger" style={styles.notice}>Fare changed from {formatNaira(fareChange.previousFareKobo)} to {formatNaira(fareChange.newFareKobo)}. Review the new price before booking.</Text> : null}

        <View style={[styles.metrics, { borderColor: colors.border }]}>
          <View style={[styles.metricRow, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
            <DetailMetric icon="distance" label="Est. distance" value={estimate ? `${estimate.distanceKm.toFixed(1)} km` : quotePendingLabel} />
            <View style={[styles.metricDivider, { backgroundColor: colors.border }]} />
            <DetailMetric icon="clock" label="Est. trip time" value={estimate ? `${Math.ceil(estimate.durationMin)} min` : quotePendingLabel} />
          </View>
          <View style={styles.metricRow}>
            <DetailMetric icon="vehicle" label="Vehicle" value="Economy" />
            <View style={[styles.metricDivider, { backgroundColor: colors.border }]} />
            <DetailMetric icon="passenger" label="Seats" value={String(RIDE.seats)} />
          </View>
        </View>

        <View style={[styles.routeSummary, { borderColor: colors.border }]}>
          <LocationRow kind="pickup" label="Pickup" value={pickup?.address ?? 'Choose pickup'} />
          <View style={[styles.routeConnector, { backgroundColor: colors.borderStrong }]} />
          <LocationRow kind="dropoff" label="Drop-off" value={dropoff?.address ?? 'Choose destination'} />
        </View>
        {scheduledTime ? <Text variant="caption" color="primary" style={styles.notice}>Pickup {formatScheduledTime(scheduledTime, { dateStyle: 'medium', timeStyle: 'short' })} WAT</Text> : null}
        <Text variant="caption" color="textMuted" style={styles.notice}>{scheduledAt ? 'We start looking for a driver about 5 minutes before pickup. A driver is not guaranteed until one accepts.' : 'Arrival time appears after a driver accepts.'}</Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(16, insets.bottom) }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Choose payment method. Current method: ${selectedPayment.name}`} onPress={() => setPaymentOpen(true)} style={[styles.paymentRow, { borderColor: colors.border }]}>
          <RideIcon name={selectedPayment.icon} size={18} color="primary" />
          <View style={styles.paymentCopy}><Text variant="button">{selectedPayment.name}</Text><Text variant="caption" color="textMuted">{payment === 'wallet' ? walletBalanceLabel : selectedPayment.detail}</Text></View>
          <RideIcon name="chevron" size={16} color="textMuted" />
        </Pressable>
        <Button label={`${scheduledAt ? 'Schedule' : 'Request'} ride · ${fareLabel}`} fullWidth loading={requesting || submitting} disabled={!estimate || (payment === 'wallet' && walletUnavailable)} onPress={() => { clearFareChange(); setConfirmationOpen(true); }} className="rounded-xl" />
      </View>
    </View>

    <Modal visible={paymentOpen} transparent animationType="slide" onRequestClose={() => setPaymentOpen(false)}>
      <Pressable onPress={() => setPaymentOpen(false)} style={[styles.modalBackdrop, nativeWindTheme[theme.scheme], { backgroundColor: colors.overlay }]}>
        <Pressable onPress={event => event.stopPropagation()} style={[styles.paymentSheet, { backgroundColor: colors.surface, paddingBottom: Math.max(16, insets.bottom) }]}>
          <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} />
          <View style={styles.paymentHeader}><Text variant="bodyMedium">Payment method</Text><Pressable accessibilityRole="button" accessibilityLabel="Close payment methods" onPress={() => setPaymentOpen(false)} style={styles.iconButton}><RideIcon name="close" /></Pressable></View>
          <Text variant="caption" color="textMuted">Choose how to pay for this ride.</Text>
          <ScrollView style={styles.paymentOptions}>
            {PAYMENT_OPTIONS.map(item => (
              <Pressable key={item.id} accessibilityRole="radio" accessibilityLabel={item.name} aria-checked={item.id === payment} accessibilityState={{ checked: item.id === payment, disabled: item.id === 'wallet' && walletUnavailable }} disabled={item.id === 'wallet' && walletUnavailable} onPress={() => choosePayment(item.id)} style={[styles.paymentOption, { borderBottomColor: colors.border }]}>
                <RideIcon name={item.icon} size={18} color={item.id === payment ? 'primary' : 'icon'} />
                <View style={styles.paymentCopy}>
                  <Text variant="button">{item.name}</Text>
                  <Text variant="caption" color="textMuted">{item.id === 'cash' ? item.detail : scheduledAt ? 'Funds must be available when driver search begins' : walletLoading || walletError ? walletBalanceLabel : estimate && walletKobo < estimate.fareKobo ? `Top up ${formatNaira(estimate.fareKobo - walletKobo)} to pay with wallet` : `Available balance: ${formatNaira(walletKobo)}`}</Text>
                </View>
                <View style={[styles.radio, { borderColor: item.id === payment ? colors.primary : colors.borderStrong }]}>{item.id === payment ? <View style={[styles.radioDot, { backgroundColor: colors.primary }]} /> : null}</View>
              </Pressable>
            ))}
            {walletError ? <Pressable accessibilityRole="button" onPress={() => void refreshWallet()} style={styles.retry}><Text variant="caption" color="primary">Retry wallet balance</Text></Pressable> : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
    <RideConfirmationModal visible={confirmationOpen} loading={submitting} rideName={RIDE.name} fareKobo={estimate?.fareKobo ?? null} paymentName={selectedPayment.name} pickupAddress={pickup?.address ?? 'Pickup location'} dropoffAddress={dropoff?.address ?? 'Destination'} scheduledAt={scheduledAt} onClose={() => setConfirmationOpen(false)} onConfirm={() => void confirmRequest()} />
  </View>;
}

function DetailMetric({ icon, label, value }: { icon: 'distance' | 'clock' | 'vehicle' | 'passenger'; label: string; value: string }) {
  return <View style={styles.metric}>
    <RideIcon name={icon} size={16} />
    <View style={styles.metricCopy}><Text variant="caption" color="textMuted">{label}</Text><Text variant="button">{value}</Text></View>
  </View>;
}

function LocationRow({ kind, label, value }: { kind: 'pickup' | 'dropoff'; label: string; value: string }) {
  return <View style={styles.locationRow}>
    <AddressIcon name={kind === 'pickup' ? 'pickup' : 'pin'} size={16} color={kind === 'pickup' ? 'mapPickup' : 'mapDropoff'} />
    <View style={styles.locationCopy}><Text variant="caption" color="textMuted">{label}</Text><Text variant="caption" numberOfLines={2} accessibilityLabel={value}>{value}</Text></View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  mapControls: { position: 'absolute', top: 0, left: 16, paddingTop: 8 },
  backButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', elevation: 3 },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 10, overflow: 'hidden', elevation: 5 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 10 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  title: { marginBottom: 0 },
  rideSummary: { minHeight: 72, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rideCopy: { flex: 1, minWidth: 0, gap: 3 },
  rideNameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  recommended: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  fareCopy: { maxWidth: 128, flexShrink: 1, alignItems: 'flex-end' },
  metrics: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10 },
  metricRow: { minHeight: 50, flexDirection: 'row', alignItems: 'stretch' },
  metric: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingHorizontal: 4 },
  metricCopy: { flex: 1, minWidth: 0 },
  metricDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: 8, marginVertical: 8 },
  routeSummary: { borderWidth: 1, borderRadius: 14, padding: 10 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  locationCopy: { flex: 1, minWidth: 0 },
  routeConnector: { width: 1, height: 8, marginLeft: 8, marginVertical: 2 },
  notice: { paddingVertical: 2 },
  retry: { minHeight: 48, justifyContent: 'center', paddingVertical: 8 },
  footer: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  paymentRow: { minHeight: 56, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  paymentCopy: { flex: 1, minWidth: 0, gap: 2 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end' },
  paymentSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 16, maxHeight: '80%' },
  paymentHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  paymentOptions: { flexGrow: 0, marginTop: 8 },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  paymentOption: { minHeight: 72, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 14 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
