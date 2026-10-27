import { AppMessage } from '@/components/common/AppMessage';
import { feedback } from '@/store/feedbackStore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { AppMap, RideConfirmationModal, type AppMapMarker } from '@/components/map';
import { AddressIcon } from '@/components/map/AddressIcon';
import { borderWidths, nativeWindTheme, useTheme } from '@/constants/theme';
import { getTripRoute } from '@/services/mapsService';
import { useTripQuote } from '@/hooks/useTripQuote';
import { apiErrorMessage } from '@/lib/apiClient';
import { useMapStore } from '@/store/mapStore';
import { useTripStore } from '@/store/tripStore';
import { TripQuoteError } from '@/services/tripService';
import { useWalletStore } from '@/store/walletStore';
import { formatNaira } from '@/services/paymentService';
import { formatScheduledTime, SCHEDULE_MAX_LEAD_MS, SCHEDULE_MIN_LEAD_MS } from '@/utils/scheduleTime';

type RideId = 'economy';
type PaymentId = 'cash' | 'wallet';

const RIDES = [
  { id: 'economy' as const, name: 'Ride', description: 'Everyday rides', seats: 4 },
] as const;

const PAYMENTS = [
  { id: 'cash' as const, name: 'Cash', detail: 'Pay after your trip', icon: 'cash' },
  { id: 'wallet' as const, name: 'Rakky Ride wallet', detail: 'Pay with your wallet balance', icon: 'wallet' },
] as const;

export function RideSelectionScreen() {
  const router = useRouter();
  const { scheduledAt } = useLocalSearchParams<{ scheduledAt?: string }>();
  const scheduledTime = scheduledAt ? new Date(scheduledAt).getTime() : null;
  const theme = useTheme();
  const { colors } = theme;
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const sheetHeight = Math.min(356 + insets.bottom, height * 0.62);
  const pickup = useMapStore((state) => state.pickupLocation);
  const dropoff = useMapStore((state) => state.dropoffLocation);
  const route = useMapStore((state) => state.routeCoordinates);
  const setRouteForEndpoints = useMapStore((state) => state.setRouteForEndpoints);
  const region = useMapStore((state) => state.cameraRegion);
  const [selectedRide, setSelectedRide] = useState<RideId>('economy');
  const [payment, setPayment] = useState<PaymentId>('cash');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [routeAttempt, setRouteAttempt] = useState(0);
  const [routeFailure, setRouteFailure] = useState<{ pickup: typeof pickup; dropoff: typeof dropoff; attempt: number } | null>(null);
  const { estimate, error: quoteError, fareChange, clearFareChange, retry: retryQuote, refresh: refreshQuote, ensureFresh } = useTripQuote(pickup, dropoff);
  const routeFailed = route.length < 2 && routeFailure?.pickup === pickup && routeFailure?.dropoff === dropoff && routeFailure?.attempt === routeAttempt;
  const [confirmationFor, setConfirmationFor] = useState<{ pickup: typeof pickup; dropoff: typeof dropoff } | null>(null);
  const confirmationOpen = !!estimate && !fareChange && confirmationFor?.pickup === pickup && confirmationFor?.dropoff === dropoff;
  const setConfirmationOpen = (open: boolean) => setConfirmationFor(open ? { pickup, dropoff } : null);
  const [submitting, setSubmitting] = useState(false);
  const submissionInFlight = useRef(false);
  const requestTrip=useTripStore(state=>state.request),requesting=useTripStore(state=>state.loading);
  const walletKobo=useWalletStore(state=>state.walletKobo),refreshWallet=useWalletStore(state=>state.refresh);
  const walletLoading = useWalletStore(state => state.loading);
  const walletError = useWalletStore(state => state.error);
  const [requestError, setRequestError] = useState<string | null>(null);
  const requestKey=useRef<string|null>(null);

  useEffect(() => {
    if (!pickup || !dropoff || route.length > 1) return;
    let active = true;
    void getTripRoute(pickup, dropoff).then((result) => {
      if (result.coordinates.length < 2) throw new Error('Route is empty');
      if (active) setRouteForEndpoints(pickup, dropoff, result.coordinates);
    }).catch(() => {
      if (active) setRouteFailure({ pickup, dropoff, attempt: routeAttempt });
    });
    return () => { active = false; };
  }, [dropoff, pickup, route.length, routeAttempt, setRouteForEndpoints]);
  useEffect(()=>{void refreshWallet();},[refreshWallet]);

  const confirmRequest = async () => {
    if (!pickup || !dropoff || !estimate || requesting || submissionInFlight.current) return;
    if (scheduledAt && (!scheduledTime || scheduledTime < Date.now() + SCHEDULE_MIN_LEAD_MS || scheduledTime > Date.now() + SCHEDULE_MAX_LEAD_MS)) {
      setConfirmationOpen(false);
      feedback.show('Choose a pickup time between 30 minutes and 7 days from now.', 'warning');
      router.replace('/schedule');
      return;
    }
    setRequestError(null);
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
      setRequestError(apiErrorMessage(reason));
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  };

  const markers = useMemo<AppMapMarker[]>(() => [
    ...(pickup ? [{ ...pickup, id: 'pickup', kind: 'pickup' as const }] : []),
    ...(dropoff ? [{ ...dropoff, id: 'dropoff', kind: 'dropoff' as const }] : []),
  ], [dropoff, pickup]);
  const selected = RIDES.find((ride) => ride.id === selectedRide) ?? RIDES[0];
  const selectedPayment = PAYMENTS.find((item) => item.id === payment) ?? PAYMENTS[0];
  const fareLabel = estimate ? formatNaira(estimate.fareKobo) : quoteError ? 'Fare unavailable' : 'Calculating…';
  const goBack = () => router.canGoBack() ? router.back() : router.replace('/set-destination');

  const editRoute = () => router.push({ pathname: '/set-destination', params: scheduledAt ? { scheduledAt } : {} });
  const openRideDetails = (ride: RideId) => router.push({ pathname: '/ride-details', params: { ride, ...(scheduledAt ? { scheduledAt } : {}) } });
  const walletUnavailable = !scheduledAt && (walletLoading || !!walletError);
  const walletBalanceLabel = walletLoading ? 'Updating balance…' : walletError ? 'Balance unavailable' : `Balance: ${formatNaira(walletKobo)}`;
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
      <AppMap region={region} markers={markers} polyline={route} fitRouteOnChange mapPadding={{ top: insets.top + 100, right: 28, bottom: 32, left: 28 }} />
    </View>
    <SafeAreaView edges={['top']} style={styles.routeOverlay}>
      <View style={[styles.routeBar, { backgroundColor: colors.surface }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to previous page" onPress={goBack} style={styles.iconButton}><AddressIcon name="back" size={20} /></Pressable>
        <View style={[styles.routeDivider, { backgroundColor: colors.border }]} />
        <View style={styles.routeAddresses}>
          <View style={styles.addressRow}>
            <AddressIcon name="pickup" size={14} color="mapPickup" />
            <Text variant="caption" style={styles.addressText} numberOfLines={1} accessibilityLabel={`Pickup: ${pickup?.address ?? 'Choose pickup'}`}>{pickup?.address ?? 'Choose pickup'}</Text>
          </View>
          <View style={styles.addressRow}>
            <AddressIcon name="pin" size={14} color="mapDropoff" />
            <Text variant="caption" style={styles.addressText} numberOfLines={1} accessibilityLabel={`Destination: ${dropoff?.address ?? 'Choose destination'}`}>{dropoff?.address ?? 'Choose destination'}</Text>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit pickup and destination" onPress={editRoute} style={styles.iconButton}><AddressIcon name="edit" size={18} /></Pressable>
      </View>
    </SafeAreaView>

    <View style={[styles.sheet, { height: sheetHeight, backgroundColor: colors.surface }]}>
      <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heading}>
          <Text variant="bodyMedium">Choose your ride</Text>
          <Text variant="caption" color="textMuted">{!pickup || !dropoff ? 'Choose pickup and destination to see your fare.' : scheduledTime ? `Pickup ${formatScheduledTime(scheduledTime, { dateStyle: 'medium', timeStyle: 'short' })} WAT` : 'Arrival time appears after a driver accepts'}</Text>
        </View>
        {routeFailed ? <Pressable accessibilityRole="button" onPress={() => setRouteAttempt(attempt => attempt + 1)} style={styles.retry}><Text variant="caption" color="primary">Map route unavailable. Retry route</Text></Pressable> : null}
        {quoteError ? <AppMessage message={quoteError} actionLabel="Retry fare" onAction={retryQuote} style={styles.retry} /> : null}
        {fareChange ? <AppMessage tone="warning" style={styles.fareNotice} message={`Fare changed from ${formatNaira(fareChange.previousFareKobo)} to ${formatNaira(fareChange.newFareKobo)}. Review the new price before booking.`} /> : null}

        {RIDES.map(ride => {
          const active = ride.id === selectedRide;
          return <View key={ride.id} style={[styles.rideCard, { backgroundColor: active ? colors.primarySoft : colors.surfaceMuted, borderColor: active ? colors.primary : colors.border }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${ride.name}, ${ride.seats} seats, ${fareLabel}. View ride details`} accessibilityState={{ selected: active }} onPress={() => active ? openRideDetails(ride.id) : setSelectedRide(ride.id)} style={styles.rideSummary}>
              <View style={styles.vehicleInfo}>
                <RideIcon name="car" size={42} color="primary" />
                <View style={styles.rideCopy}>
                  <Text variant="button">{ride.name}</Text>
                  <View style={styles.seats}><RideIcon name="passenger" size={14} color="textMuted" /><Text variant="caption" color="textMuted">{ride.seats} seats</Text></View>
                  <Text variant="caption" color="textMuted">{ride.description}</Text>
                </View>
              </View>
              <View style={styles.fareGroup}>
                <View style={styles.fareCopy}><Text variant="button">{fareLabel}</Text><Text variant="caption" color="textMuted">Quoted fare</Text></View>
                {active ? <View style={[styles.selectedCheck, { backgroundColor: colors.primary }]}><RideIcon name="check" size={13} color="textInverse" /></View> : null}
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`View ${ride.name.toLowerCase()} details`} onPress={() => openRideDetails(ride.id)} style={[styles.detailsLink, { borderTopColor: colors.border }]}>
              <Text variant="caption" color="primary">View ride details</Text><RideIcon name="chevron" size={14} color="primary" />
            </Pressable>
          </View>;
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(16, insets.bottom) }]}>
        {requestError ? <AppMessage message={requestError} /> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={`Choose payment method. Current method: ${selectedPayment.name}`} onPress={() => setPaymentOpen(true)} style={[styles.paymentRow, { borderColor: colors.border }]}>
          <RideIcon name={selectedPayment.icon} size={18} color="primary" />
          <View style={styles.paymentCopy}><Text variant="button">{selectedPayment.name}</Text><Text variant="caption" color="textMuted">{payment === 'wallet' ? walletBalanceLabel : selectedPayment.detail}</Text></View>
          <RideIcon name="down" size={16} color="textMuted" />
        </Pressable>
        <Button label={`${scheduledAt ? 'Schedule' : 'Request'} ${selected.name} · ${fareLabel}`} fullWidth loading={requesting || submitting} disabled={!estimate || (payment === 'wallet' && walletUnavailable)} onPress={() => { clearFareChange(); setConfirmationOpen(true); }} className="rounded-xl" />
      </View>
    </View>

    <Modal visible={paymentOpen} transparent animationType="slide" onRequestClose={() => setPaymentOpen(false)}>
      <Pressable accessibilityLabel="Dismiss payment methods" onPress={() => setPaymentOpen(false)} style={[styles.modalBackdrop, nativeWindTheme[theme.scheme], { backgroundColor: colors.overlay }]}>
        <Pressable onPress={event => event.stopPropagation()} style={[styles.paymentSheet, { backgroundColor: colors.surface, paddingBottom: Math.max(16, insets.bottom) }]}>
          <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} />
          <View style={styles.paymentHeader}><Text variant="bodyMedium">Payment method</Text><Pressable accessibilityRole="button" accessibilityLabel="Close payment methods" onPress={() => setPaymentOpen(false)} style={styles.iconButton}><RideIcon name="close" /></Pressable></View>
          <Text variant="caption" color="textMuted">Choose how to pay for this ride.</Text>
          <ScrollView style={styles.paymentOptions}>
            {PAYMENTS.map(item => (
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
    <RideConfirmationModal visible={confirmationOpen} loading={submitting} rideName={selected.name} fareKobo={estimate?.fareKobo ?? null} paymentName={selectedPayment.name} pickupAddress={pickup?.address ?? 'Pickup location'} dropoffAddress={dropoff?.address ?? 'Destination'} scheduledAt={scheduledAt} onClose={() => setConfirmationOpen(false)} onConfirm={() => void confirmRequest()} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  routeOverlay: { position: 'absolute', top: 0, left: 16, right: 16, paddingTop: 8 },
  routeBar: { minHeight: 76, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 4, elevation: 3 },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  routeDivider: { width: borderWidths.divider, height: 36, marginRight: 6 },
  routeAddresses: { flex: 1, minWidth: 0, gap: 6 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addressText: { flex: 1 },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 10, overflow: 'hidden', elevation: 5 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 8 },
  heading: { gap: 2, marginBottom: 12 },
  retry: { minHeight: 48, justifyContent: 'center', paddingVertical: 8 },
  fareNotice: { marginBottom: 12 },
  rideCard: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12 },
  rideSummary: { minHeight: 78, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  vehicleInfo: { flex: 1, minWidth: 142, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rideCopy: { flex: 1, minWidth: 0, gap: 2 },
  seats: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fareGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fareCopy: { alignItems: 'flex-end', maxWidth: 140 },
  selectedCheck: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  detailsLink: { minHeight: 44, borderTopWidth: borderWidths.divider, flexDirection: 'row', alignItems: 'center', gap: 6 },
  footer: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  paymentRow: { minHeight: 60, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  paymentCopy: { flex: 1, minWidth: 0, gap: 2 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end' },
  paymentSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 16, maxHeight: '80%' },
  paymentHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  paymentOptions: { flexGrow: 0, marginTop: 8 },
  paymentOption: { minHeight: 72, borderBottomWidth: borderWidths.divider, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 14 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
