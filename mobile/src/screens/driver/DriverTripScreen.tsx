import { useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppMap, type AppMapHandle, type AppMapMarker } from '@/components/map';
import { Avatar, Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { AddressIcon } from '@/components/map/AddressIcon';
import { DriverTripConfirmation, type DriverTripConfirmationAction } from '@/components/trip/DriverTripConfirmation';
import { useTheme } from '@/constants/theme';
import { useTripMapRoute } from '@/hooks/useTripMapRoute';
import { apiErrorMessage } from '@/lib/apiClient';
import { formatNaira } from '@/services/paymentService';
import { useMapStore } from '@/store/mapStore';
import { useTripStore } from '@/store/tripStore';
import { activeTripRegion } from '@/utils/tripCamera';

export function DriverTripScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const map = useRef<AppMapHandle>(null);
  const actionInFlight = useRef(false);
  const trip = useTripStore(state => state.trip);
  const loading = useTripStore(state => state.loading);
  const arrived = useTripStore(state => state.arrived);
  const start = useTripStore(state => state.start);
  const complete = useTripStore(state => state.complete);
  const returnDelivery = useTripStore(state => state.returnDelivery);
  const cancel = useTripStore(state => state.cancel);
  const region = useMapStore(state => state.cameraRegion);
  const current = useMapStore(state => state.currentLocation);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<DriverTripConfirmationAction | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [overview, setOverview] = useState(false);
  const courier = trip?.service_type === 'courier';
  const travelling = trip?.status === 'in_progress' || trip?.status === 'returning';
  const route = useTripMapRoute(trip, current);
  const followRegion = activeTripRegion(trip?.status, current);
  const sheetHeight = Math.min(480 + insets.bottom, height * 0.54);
  const busy = loading || submitting;
  const markers = useMemo<AppMapMarker[]>(() => trip ? [
    { id: 'pickup', kind: 'pickup', latitude: trip.pickup_lat, longitude: trip.pickup_lng, title: trip.pickup_address },
    { id: 'dropoff', kind: 'dropoff', latitude: trip.dropoff_lat, longitude: trip.dropoff_lng, title: trip.dropoff_address },
    ...(current ? [{ id: 'driver', kind: 'driver' as const, ...current, title: 'Your location' }] : []),
  ] : [], [current, trip]);

  if (!trip) return <Redirect href="/driver-dashboard" />;
  if (trip.status === 'completed' || trip.status === 'returned') return <Redirect href="/trip-complete" />;
  if (trip.status === 'cancelled' || trip.status === 'no_drivers_found') return <Redirect href="/driver-dashboard" />;

  const returning = trip.status === 'returning';
  const atPickup = trip.status === 'driver_arrived';
  const title = returning ? 'Returning to sender' : travelling ? courier ? 'Delivery in progress' : 'Trip in progress'
    : atPickup ? courier ? 'Collect the package' : 'Ready to go?' : 'Head to pickup';
  const actionLabel = returning ? 'Confirm return' : travelling ? courier ? 'Confirm delivery' : 'Complete trip'
    : atPickup ? courier ? 'Package collected' : 'Start trip' : 'I have arrived';
  const targetAddress = trip.status === 'in_progress' ? trip.dropoff_address : trip.pickup_address;
  const targetLabel = returning ? 'Return to pickup' : trip.status === 'in_progress' ? 'Drop-off' : 'Pickup';
  const steps = returning ? ['Collected', 'Returning', 'Hand back'] : ['Pickup', courier ? 'Delivery' : 'On trip', 'Drop-off'];
  const currentStep = travelling ? 1 : 0;
  const paymentName = trip.payment_method === 'cash' ? 'Cash to collect' : trip.payment_method === 'card' ? 'Card payment' : 'Wallet payment';

  const runAction = async () => {
    if (busy || actionInFlight.current) return;
    if (travelling) { setConfirmation('complete'); return; }
    actionInFlight.current = true;
    setSubmitting(true);
    setActionError(null);
    try { if (atPickup) await start(); else await arrived(); }
    catch (error) { setActionError(apiErrorMessage(error)); }
    finally { actionInFlight.current = false; setSubmitting(false); }
  };
  const confirmAction = async (code?: string) => {
    if (confirmation === 'complete') await complete(code);
    else if (confirmation === 'cancel') await cancel('Driver can no longer complete the trip');
    else if (confirmation === 'return') await returnDelivery('Recipient unavailable at drop-off');
    // The store's confirmed trip status drives the redirect; a failed request stays here.
  };
  const openNavigation = async () => {
    const target = trip.status === 'in_progress'
      ? { latitude: trip.dropoff_lat, longitude: trip.dropoff_lng }
      : { latitude: trip.pickup_lat, longitude: trip.pickup_lng };
    try { await Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${target.latitude},${target.longitude}&travelmode=driving`); }
    catch (error) { setActionError(apiErrorMessage(error)); }
  };
  const follow = () => {
    setOverview(false);
    const focus = followRegion ?? (current ? { ...current, latitudeDelta: 0.018, longitudeDelta: 0.014 } : null);
    if (focus) map.current?.animateToRegion(focus);
  };

  return <View style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={[StyleSheet.absoluteFill, { bottom: sheetHeight - 26 }]}>
      <AppMap ref={map} region={followRegion ?? region} markers={markers} polyline={route.primary} secondaryPolyline={route.secondary}
        fitRouteOnChange={overview || !followRegion} mapPadding={{ top: insets.top + 80, right: 28, bottom: 48, left: 28 }} />
    </View>
    <View pointerEvents="box-none" style={[styles.mapHeader, { top: insets.top + 12 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to driver home" onPress={() => router.replace('/driver-dashboard')} style={[styles.round, { backgroundColor: colors.surface }]}><AddressIcon name="back" size={21} /></Pressable>
      <View style={[styles.headerPill, { backgroundColor: colors.surface }]}><RideIcon name={courier ? 'package' : 'vehicle'} color="primary" size={17} /><Text variant="button">{courier ? 'Courier trip' : 'Passenger trip'}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Open driver safety" onPress={() => router.push({ pathname: '/account/[section]', params: { section: 'safety' } })} style={[styles.round, { backgroundColor: colors.surface }]}><RideIcon name="safety" size={21} /></Pressable>
    </View>
    <View style={[styles.mapTools, { bottom: sheetHeight + 14 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="View full trip route" accessibilityState={{ selected: overview }} onPress={() => setOverview(true)} style={[styles.round, { backgroundColor: overview ? colors.primarySoft : colors.surface }]}><RideIcon name="distance" color={overview ? 'primary' : 'text'} size={20} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Follow my location" accessibilityState={{ selected: !overview }} onPress={follow} style={[styles.round, { backgroundColor: !overview ? colors.primarySoft : colors.surface }]}><AddressIcon name="locate" color={!overview ? 'primary' : 'text'} size={20} /></Pressable>
    </View>
    <View style={[styles.sheet, { height: sheetHeight, backgroundColor: colors.surface }]}>
      <View style={styles.handleArea}><View style={[styles.handle, { backgroundColor: colors.borderStrong }]} /></View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
        <View style={styles.titleRow}><View style={[styles.liveDot, { backgroundColor: colors.primary }]} /><Text variant="bodyMedium" accessibilityRole="header" style={styles.flex}>{title}</Text><Text variant="caption" color="primary">{returning ? 'Return' : atPickup ? 'At pickup' : travelling ? 'On the way' : 'Pickup'}</Text></View>
        <View accessibilityLabel={`Trip progress: ${steps[currentStep]}`} style={styles.progress}>
          {steps.map((step, index) => <View key={step} style={styles.flex}><View style={[styles.progressLine, { backgroundColor: index <= currentStep ? colors.primary : colors.border }]} /><Text variant="caption" color={index <= currentStep ? 'primary' : 'textMuted'}>{step}</Text></View>)}
        </View>
        <View style={[styles.destination, { borderColor: colors.border }]}>
          <AddressIcon name={trip.status === 'in_progress' ? 'pin' : 'pickup'} size={19} color={trip.status === 'in_progress' ? 'mapDropoff' : 'mapPickup'} />
          <View style={styles.flex}><Text variant="caption" color="textMuted">{targetLabel}</Text><Text variant="bodyMedium" numberOfLines={2}>{targetAddress}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Open in Google Maps" onPress={() => void openNavigation()} style={[styles.navigate, { backgroundColor: colors.primarySoft }]}><RideIcon name="outgoing" color="primary" size={19} /><Text variant="caption" color="primary">Navigate</Text></Pressable>
        </View>
        <View style={styles.personRow}>
          <Avatar name={trip.rider_name ?? 'Rider'} />
          <View style={styles.flex}><Text variant="bodyMedium" numberOfLines={1}>{trip.rider_name ?? 'Rider'}</Text><Text variant="caption" color="textMuted">{courier ? 'Sender' : 'Rider'}</Text></View>
          <Button label="Message" size="sm" variant="secondary" onPress={() => router.push({ pathname: '/trip-chat', params: { tripId: trip.id, participantName: trip.rider_name ?? 'Rider' } })} />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={detailsOpen ? 'Hide trip details' : 'Show trip details'} accessibilityState={{ expanded: detailsOpen }} onPress={() => setDetailsOpen(!detailsOpen)} style={styles.detailsToggle}><Text variant="caption" color="textMuted">Trip details</Text><View style={{ transform: [{ rotate: detailsOpen ? '180deg' : '0deg' }] }}><RideIcon name="down" color="textMuted" size={16} /></View></Pressable>
        {detailsOpen ? <View style={[styles.details, { backgroundColor: colors.surfaceMuted }]}>
          <RouteRow label="Pickup" address={trip.pickup_address} /><RouteRow label="Drop-off" address={trip.dropoff_address} />
          {courier && trip.courier_details ? <>
            <View style={styles.inline}><RideIcon name="package" size={18} color="primary" /><Text variant="caption" style={styles.flex}>{trip.courier_details.description} · {trip.courier_details.weightKg} kg</Text></View>
            <Text variant="caption">Recipient: {trip.courier_details.recipientName}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Call recipient" onPress={() => void Linking.openURL(`tel:${trip.courier_details?.recipientPhone}`).catch(error => setActionError(apiErrorMessage(error)))} style={styles.detailsToggle}><RideIcon name="phone" color="primary" size={17} /><Text variant="caption" color="primary">{trip.courier_details.recipientPhone}</Text></Pressable>
            {trip.courier_details.pickupInstructions ? <Text variant="caption">Pickup: {trip.courier_details.pickupInstructions}</Text> : null}
            {trip.courier_details.dropoffInstructions ? <Text variant="caption">Drop-off: {trip.courier_details.dropoffInstructions}</Text> : null}
          </> : null}
          {!travelling ? <Button label="Cancel trip" variant="ghost" size="sm" disabled={busy} onPress={() => setConfirmation('cancel')} /> : null}
        </View> : null}
        {courier && trip.status === 'in_progress' ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirmation('return')} style={styles.detailsToggle}><RideIcon name="info" size={17} color="warning" /><Text variant="caption" color="textMuted">Recipient unavailable?</Text><RideIcon name="chevron" size={15} color="textMuted" /></Pressable> : null}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
        {actionError ? <Text variant="caption" color="danger" accessibilityRole="alert">{actionError}</Text> : null}
        <View style={styles.payment}><RideIcon name={trip.payment_method === 'cash' ? 'cash' : trip.payment_method === 'card' ? 'card' : 'wallet'} color="primary" size={19} /><Text variant="caption" color="textMuted" style={styles.flex}>{paymentName}</Text><Text variant="bodyMedium">{formatNaira(trip.fare_kobo)}</Text></View>
        <Button label={actionLabel} fullWidth loading={busy} onPress={() => void runAction()} rightIcon={<RideIcon name={travelling ? 'check' : 'chevron'} color="textInverse" size={18} />} />
      </View>
    </View>
    {confirmation ? <DriverTripConfirmation key={`${trip.id}:${confirmation}:${trip.status}`} trip={trip} action={confirmation} busy={busy} onClose={() => setConfirmation(null)} onConfirm={confirmAction} /> : null}
  </View>;
}

function RouteRow({ label, address }: { label: string; address: string }) {
  return <View style={styles.inline}><AddressIcon name={label === 'Pickup' ? 'pickup' : 'pin'} size={16} color={label === 'Pickup' ? 'mapPickup' : 'mapDropoff'} /><View style={styles.flex}><Text variant="caption" color="textMuted">{label}</Text><Text variant="caption">{address}</Text></View></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, flex: { flex: 1, minWidth: 0 },
  mapHeader: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  round: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', elevation: 3 },
  headerPill: { minHeight: 40, borderRadius: 22, paddingHorizontal: 14, flexDirection: 'row', gap: 8, alignItems: 'center' },
  mapTools: { position: 'absolute', right: 16, gap: 8 },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden', elevation: 6 },
  handleArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 12 }, handle: { height: 4, width: 36, borderRadius: 2 },
  scroll: { flex: 1 }, content: { paddingHorizontal: 20, paddingBottom: 8, gap: 12 },
  titleRow: { flexDirection: 'row', gap: 8, alignItems: 'center' }, liveDot: { width: 7, height: 7, borderRadius: 4 },
  progress: { flexDirection: 'row', gap: 8 }, progressLine: { height: 3, borderRadius: 2, marginBottom: 5 },
  destination: { flexDirection: 'row', gap: 10, alignItems: 'center', borderWidth: 1, borderRadius: 14, padding: 12 },
  navigate: { minHeight: 48, minWidth: 64, borderRadius: 10, padding: 8, alignItems: 'center', justifyContent: 'center', gap: 3 },
  personRow: { minHeight: 44, flexDirection: 'row', gap: 10, alignItems: 'center' },
  detailsToggle: { minHeight: 44, flexDirection: 'row', gap: 8, alignItems: 'center' },
  details: { padding: 12, borderRadius: 12, gap: 12 }, inline: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  footer: { paddingHorizontal: 20, paddingTop: 12, gap: 10, borderTopWidth: 1 }, payment: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
