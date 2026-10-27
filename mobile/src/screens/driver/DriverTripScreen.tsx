import { AppMessage } from '@/components/common/AppMessage';
import { useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppMap, type AppMapHandle, type AppMapMarker } from '@/components/map';
import { Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { AddressIcon } from '@/components/map/AddressIcon';
import { DriverTripConfirmation, type DriverTripConfirmationAction } from '@/components/trip/DriverTripConfirmation';
import { useTheme } from '@/constants/theme';
import { useTripMapRoute } from '@/hooks/useTripMapRoute';
import { apiErrorMessage } from '@/lib/apiClient';
import { formatNaira } from '@/services/paymentService';
import { useMapStore } from '@/store/mapStore';
import { useTripStore } from '@/store/tripStore';
import { TripCallOptions } from '@/components/communication/TripCallOptions';
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
  const [callOpen,setCallOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [overview, setOverview] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(Math.min(520, height * 0.64));
  const courier = trip?.service_type === 'courier';
  const travelling = trip?.status === 'in_progress' || trip?.status === 'returning';
  const route = useTripMapRoute(trip, current);
  const followRegion = activeTripRegion(trip?.status, current);
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
  const description = returning ? 'Take the package back to pickup and confirm the handoff with the sender.'
    : travelling ? courier ? 'Head to the recipient. Confirm delivery after the package is handed over.' : 'Follow the route to your rider’s destination.'
      : atPickup ? courier ? 'Check the package with the sender, then start the delivery.' : 'Meet your rider and start when everyone is ready.'
        : courier ? 'Meet the sender at the pickup point to collect the package.' : 'Your rider is waiting at the pickup point.';
  const actionLabel = returning ? 'Confirm return' : travelling ? courier ? 'Confirm delivery' : 'Complete trip'
    : atPickup ? courier ? 'Package collected' : 'Start trip' : 'I have arrived';
  const targetAddress = trip.status === 'in_progress' ? trip.dropoff_address : trip.pickup_address;
  const targetLabel = returning ? 'Return to pickup' : trip.status === 'in_progress' ? 'Drop-off' : 'Pickup';
  const paymentName = trip.payment_method === 'cash' ? 'Cash to collect' : trip.payment_method === 'card' ? 'Card payment' : 'Wallet payment';
  const riderName = trip.rider_name?.trim() || (courier ? 'Your sender' : 'Your rider');

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
    <View style={StyleSheet.absoluteFill}>
      <AppMap ref={map} region={followRegion ?? region} markers={markers} polyline={route.primary} secondaryPolyline={route.secondary}
        fitRouteOnChange={overview || !followRegion} mapPadding={{ top: insets.top + 112, right: 36, bottom: sheetHeight + 24, left: 36 }} />
    </View>
    <View pointerEvents="box-none" style={[styles.mapHeader, { top: insets.top + 12 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to driver home" onPress={() => router.replace('/driver-dashboard')} style={[styles.round, { backgroundColor: colors.surface }]}><AddressIcon name="back" size={21} /></Pressable>
      <View style={[styles.destinationHeader, { backgroundColor: colors.surface }]}>
        <View style={styles.flex}><Text variant="bodyMedium">{targetLabel}</Text><Text variant="caption" color="textMuted" numberOfLines={1}>{targetAddress}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Open in Google Maps" onPress={() => void openNavigation()} style={[styles.navigate, { backgroundColor: colors.primarySoft }]}>
          <RideIcon name="outgoing" color="primary" size={20} /><Text variant="caption" color="primary">Navigate</Text>
        </Pressable>
      </View>
    </View>
    <View style={[styles.mapTools, { bottom: sheetHeight + 16 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="View full trip route" accessibilityState={{ selected: overview }} onPress={() => setOverview(true)} style={[styles.round, { backgroundColor: overview ? colors.primarySoft : colors.surface }]}><RideIcon name="distance" color={overview ? 'primary' : 'text'} size={20} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Follow my location" accessibilityState={{ selected: !overview }} onPress={follow} style={[styles.round, { backgroundColor: !overview ? colors.primarySoft : colors.surface }]}><AddressIcon name="locate" color={!overview ? 'primary' : 'text'} size={20} /></Pressable>
    </View>
    <View onLayout={event => { const next = Math.round(event.nativeEvent.layout.height); if (next > 0 && Math.abs(next - sheetHeight) > 1) setSheetHeight(next); }}
      style={[styles.sheet, { backgroundColor: colors.surface }]}>
      <View style={styles.handleArea}><View style={[styles.handle, { backgroundColor: colors.borderStrong }]} /></View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text variant="caption" color="secondary" className="uppercase tracking-widest">{courier ? 'Courier delivery' : 'Passenger trip'}</Text>
        <Text variant="h2" accessibilityRole="header" className="mt-xs">{title}</Text>
        <Text color="textMuted">{description}</Text>
        <View style={styles.personRow}>
          <View style={[styles.personAvatar, { backgroundColor: colors.successSoft }]}><Text variant="h2" color="success">{riderName.charAt(0).toUpperCase()}</Text></View>
          <View style={styles.flex}><Text variant="h3" numberOfLines={1}>{riderName}</Text><Text variant="caption" color="textMuted">{courier ? 'Package sender' : 'Your rider'}</Text></View>
          <View style={[styles.personBadge, { backgroundColor: colors.primarySoft }]}><RideIcon name={courier ? 'package' : 'passenger'} color="primary" size={22} /></View>
        </View>
        <View style={[styles.actions, { backgroundColor: colors.surfaceMuted }]}>
          <TripAction icon="mail" label="Message" onPress={() => router.push({ pathname: '/trip-chat', params: { tripId: trip.id, participantName: riderName } })} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <TripAction icon="phone" label="Call" onPress={() => setCallOpen(true)} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <TripAction icon="safety" label="Safety" accessibilityLabel="Open driver safety" onPress={() => router.push({ pathname: '/account/[section]', params: { section: 'safety' } })} />
        </View>
        <View style={[styles.routeCard, { backgroundColor: colors.surfaceMuted }]}>
          <RouteRow label="Pickup" address={trip.pickup_address} expanded={detailsOpen} />
          <View style={[styles.routeConnector, { backgroundColor: colors.borderStrong }]} />
          <RouteRow label={returning ? 'Original destination' : 'Destination'} address={trip.dropoff_address} expanded={detailsOpen} />
          <Pressable accessibilityRole="button" accessibilityLabel={detailsOpen ? 'Hide trip details' : 'Show trip details'} accessibilityState={{ expanded: detailsOpen }} onPress={() => setDetailsOpen(!detailsOpen)} style={[styles.detailsToggle, { borderTopColor: colors.border }]}>
            <Text variant="caption" color="textMuted" style={styles.flex}>{detailsOpen ? 'Less trip details' : 'More trip details'}</Text>
            <View style={{ transform: [{ rotate: detailsOpen ? '180deg' : '0deg' }] }}><RideIcon name="down" color="textMuted" size={16} /></View>
          </Pressable>
          {detailsOpen ? <View style={styles.details}>
            {courier && trip.courier_details ? <>
              <View style={styles.inline}><RideIcon name="package" size={18} color="primary" /><Text variant="caption" style={styles.flex}>{trip.courier_details.description} · {trip.courier_details.weightKg} kg</Text></View>
              <Text variant="caption">Recipient: {trip.courier_details.recipientName}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Call recipient" onPress={() => void Linking.openURL(`tel:${trip.courier_details?.recipientPhone}`).catch(error => setActionError(apiErrorMessage(error)))} style={styles.recipientCall}><RideIcon name="phone" color="primary" size={17} /><Text variant="caption" color="primary">{trip.courier_details.recipientPhone}</Text></Pressable>
              {trip.courier_details.pickupInstructions ? <Text variant="caption">Pickup: {trip.courier_details.pickupInstructions}</Text> : null}
              {trip.courier_details.dropoffInstructions ? <Text variant="caption">Drop-off: {trip.courier_details.dropoffInstructions}</Text> : null}
            </> : <Text variant="caption" color="textMuted">{travelling ? 'Complete the trip after reaching the destination.' : 'Confirm arrival at pickup before starting the trip.'}</Text>}
            {!travelling ? <Button label="Cancel trip" variant="ghost" size="sm" disabled={busy} onPress={() => setConfirmation('cancel')} /> : null}
          </View> : null}
        </View>
        {courier && trip.status === 'in_progress' ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirmation('return')} style={styles.recipientCall}><RideIcon name="info" size={17} color="warning" /><Text variant="caption" color="textMuted">Recipient unavailable?</Text><RideIcon name="chevron" size={15} color="textMuted" /></Pressable> : null}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
        {actionError ? <AppMessage message={actionError} /> : null}
        <View style={styles.payment}><RideIcon name={trip.payment_method === 'cash' ? 'cash' : trip.payment_method === 'card' ? 'card' : 'wallet'} color="primary" size={22} /><View style={styles.flex}><Text variant="caption" color="textMuted">{paymentName}</Text><Text variant="bodyMedium">{courier ? 'Delivery fare' : 'Trip fare'}</Text></View><Text variant="h3">{formatNaira(trip.fare_kobo)}</Text></View>
        <Button label={actionLabel} fullWidth loading={busy} onPress={() => void runAction()} rightIcon={<RideIcon name={travelling ? 'check' : 'chevron'} color="textInverse" size={18} />} />
      </View>
    </View>
    {callOpen ? <TripCallOptions tripId={trip.id} participantName={riderName} onClose={()=>setCallOpen(false)} /> : null}
    {confirmation ? <DriverTripConfirmation key={`${trip.id}:${confirmation}:${trip.status}`} trip={trip} action={confirmation} busy={busy} onClose={() => setConfirmation(null)} onConfirm={confirmAction} /> : null}
  </View>;
}

function TripAction({ icon, label, accessibilityLabel, onPress }: { icon: 'mail' | 'phone' | 'safety'; label: string; accessibilityLabel?: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} style={styles.tripAction}>
    <RideIcon name={icon} size={18} /><Text variant="caption" color="textMuted">{label}</Text>
  </Pressable>;
}

function RouteRow({ label, address, expanded }: { label: string; address: string; expanded: boolean }) {
  return <View style={styles.inline}><AddressIcon name={label === 'Pickup' ? 'pickup' : 'pin'} size={17} color={label === 'Pickup' ? 'mapPickup' : 'mapDropoff'} /><View style={styles.flex}><Text variant="caption" color="textMuted">{label}</Text><Text variant="bodyMedium" numberOfLines={expanded ? undefined : 2}>{address}</Text></View></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, flex: { flex: 1, minWidth: 0 },
  mapHeader: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  round: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', elevation: 3 },
  destinationHeader: { flex: 1, minWidth: 0, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 12, elevation: 3 },
  navigate: { minHeight: 48, minWidth: 58, borderRadius: 12, padding: 6, alignItems: 'center', justifyContent: 'center', gap: 3 },
  mapTools: { position: 'absolute', right: 16, gap: 8 },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: '70%', borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden', elevation: 6 },
  handleArea: { alignItems: 'center', paddingVertical: 12 }, handle: { height: 4, width: 48, borderRadius: 2 },
  scroll: { flexShrink: 1 }, content: { paddingHorizontal: 20, paddingBottom: 20 },
  personRow: { marginTop: 16, minHeight: 48, flexDirection: 'row', gap: 12, alignItems: 'center' },
  personAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  personBadge: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  actions: { marginTop: 16, flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingVertical: 12 },
  tripAction: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', gap: 4 }, divider: { width: 1, height: 36 },
  routeCard: { marginTop: 12, borderRadius: 12, paddingHorizontal: 12, paddingTop: 12 },
  routeConnector: { width: 1, height: 16, marginLeft: 8, marginVertical: 4 }, inline: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  detailsToggle: { marginTop: 12, minHeight: 44, borderTopWidth: 1, flexDirection: 'row', gap: 8, alignItems: 'center' },
  details: { paddingBottom: 16, gap: 12 }, recipientCall: { minHeight: 44, flexDirection: 'row', gap: 8, alignItems: 'center' },
  footer: { paddingHorizontal: 20, paddingTop: 12, gap: 12, borderTopWidth: 1 }, payment: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
