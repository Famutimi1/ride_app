import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/common';
import { RideIcon } from '@/components/common/RideIcon';
import { AppMap } from '@/components/map';
import type { AppMapProps } from '@/components/map/mapTypes';
import { AddressIcon } from '@/components/map/AddressIcon';
import { DriverSearchRadar } from '@/components/trip/DriverSearchRadar';
import { useTheme } from '@/constants/theme';
import { formatNaira } from '@/services/paymentService';
import type { Trip } from '@/services/tripService';

type SearchTrip = Pick<Trip, 'pickup_address' | 'dropoff_address' | 'payment_method' | 'fare_kobo' | 'service_type' | 'courier_details'>;

interface DriverSearchViewProps {
  trip: SearchTrip;
  mapProps: AppMapProps;
  onBack: () => void;
  onCancel: () => void;
  deliveryCode?: string | null;
  onShareCode?: () => void;
}

/** Presentation only: matching, trip updates and cancellation stay in OngoingTripScreen. */
export function DriverSearchView({ trip, mapProps, onBack, onCancel, deliveryCode, onShareCode }: DriverSearchViewProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const courier = trip.service_type === 'courier';
  const [addressesExpanded, setAddressesExpanded] = useState(false);
  const [parcelExpanded, setParcelExpanded] = useState(false);
  const sheetHeight = Math.min((courier && trip.courier_details ? deliveryCode ? 512 : 424 : 452) + insets.bottom, height * (courier ? 0.68 : 0.72));
  const paymentMethod = { wallet: 'Wallet', card: 'Card', cash: 'Cash' }[trip.payment_method];
  const paymentLabel = courier ? paymentMethod : trip.payment_method === 'wallet' ? 'Rakky Ride wallet' : trip.payment_method === 'card' ? 'Card payment' : 'Cash payment';

  return <View style={[styles.screen, { backgroundColor: colors.surfaceMuted }]}>
    <View style={[StyleSheet.absoluteFill, { bottom: sheetHeight }]}>
      <AppMap {...mapProps} fitRouteOnChange mapPadding={{ top: insets.top + 82, right: 24, bottom: 28, left: 24 }} />
    </View>
    <SafeAreaView edges={['top']} style={styles.controls}>
      <View style={styles.topRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to home" onPress={onBack} style={[styles.back, { backgroundColor: colors.surface }]}><AddressIcon name="back" size={20} /></Pressable>
        <View style={[styles.destination, { backgroundColor: colors.surface }]}>
          <Text variant="button">{courier ? 'Drop-off' : 'Your destination'}</Text>
          <Text variant="caption" color="textMuted" numberOfLines={1}>{trip.dropoff_address}</Text>
        </View>
      </View>
    </SafeAreaView>

    <View style={[styles.sheet, { height: sheetHeight, backgroundColor: colors.surface }]}>
      <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={courier ? styles.courierStatus : styles.status}>
          <View style={courier ? styles.courierAnimation : styles.animation}><DriverSearchRadar courier={courier} compact={courier} /></View>
          <View accessibilityLiveRegion="polite" role="status" style={[styles.statusCopy, courier ? styles.courierCopy : null]}>
            <Text variant="bodyMedium" style={courier ? undefined : styles.centered}>{courier ? 'Finding a courier' : 'Connecting you to a driver'}</Text>
            {!courier ? <Text variant="caption" color="textMuted" style={styles.centered}>We’ll let you know when a driver accepts.</Text> : null}
          </View>
        </View>
        {courier && trip.courier_details ? <Pressable accessibilityRole="button" accessibilityLabel={parcelExpanded ? 'Hide package details' : 'Show package and recipient details'} accessibilityState={{ expanded: parcelExpanded }} onPress={() => setParcelExpanded(value => !value)} style={[styles.parcel, { borderColor: colors.border }]}>
          <View style={[styles.parcelIcon, { backgroundColor: colors.primarySoft }]}><RideIcon name="package" size={21} color="primary" /></View>
          <View style={styles.address}><Text variant="button" numberOfLines={parcelExpanded ? undefined : 1}>{trip.courier_details.description}</Text><Text variant="caption" color="textMuted" numberOfLines={parcelExpanded ? undefined : 1}>{trip.courier_details.weightKg} kg · To {trip.courier_details.recipientName}</Text>{parcelExpanded ? <Text variant="caption" color="textMuted">{trip.courier_details.recipientPhone}</Text> : null}</View>
          <View style={styles.parcelAction}><Text variant="caption" color="primary">{parcelExpanded ? 'Less' : 'Details'}</Text><View style={parcelExpanded ? styles.arrowUp : null}><RideIcon name="down" size={14} color="primary" /></View></View>
        </Pressable> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={addressesExpanded ? 'Collapse trip addresses' : 'Show full trip addresses'} accessibilityState={{ expanded: addressesExpanded }} onPress={() => setAddressesExpanded(value => !value)} style={[styles.route, { backgroundColor: colors.surfaceMuted }]}>
          <SearchRouteRow label="Pickup" address={trip.pickup_address} expanded={addressesExpanded} toggleHint />
          <SearchRouteRow label={courier ? 'Drop-off' : 'Destination'} address={trip.dropoff_address} expanded={addressesExpanded} />
        </Pressable>
        {courier && deliveryCode ? <View style={[styles.codeCard, { backgroundColor: colors.primarySoft }]}>
          <View style={styles.codeRow}>
            {onShareCode ? <View pointerEvents="none" style={styles.codeActionSpace} /> : null}
            <View style={styles.address}><Text variant="caption" color="textMuted" style={styles.centered}>Recipient code</Text><Text variant="h3" selectable numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} accessibilityLabel={`Delivery code: ${deliveryCode.split('').join(' ')}`} style={styles.code}>{deliveryCode}</Text></View>
            {onShareCode ? <Pressable accessibilityRole="button" accessibilityLabel="Share code with recipient" onPress={onShareCode} style={[styles.share, { backgroundColor: colors.surface }]}><RideIcon name="share" size={18} color="primary" /></Pressable> : null}
          </View>
          <View style={styles.codeHint}><RideIcon name="lock" size={14} color="primary" /><Text variant="caption" color="textMuted" style={styles.address}>Recipient only. Never the driver.</Text></View>
        </View> : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16), borderTopColor: colors.border }]}>
        <View style={[styles.payment, courier ? styles.courierPayment : null]}>
          <RideIcon name={trip.payment_method === 'wallet' ? 'wallet' : trip.payment_method === 'card' ? 'card' : 'cash'} size={18} color="icon" />
          <View style={styles.paymentCopy}><Text variant="caption">{courier ? `Delivery · ${paymentLabel}` : paymentLabel}</Text>{!courier ? <Text variant="caption" color="textMuted">Upfront fare</Text> : null}</View>
          <Text variant="button" style={styles.fare}>{formatNaira(trip.fare_kobo)}</Text>
        </View>
        <Button label={courier ? 'Cancel delivery' : 'Cancel ride'} variant="outline" size="sm" fullWidth onPress={onCancel} />
      </View>
    </View>
  </View>;
}

function SearchRouteRow({ label, address, expanded, toggleHint = false }: { label: 'Pickup' | 'Destination' | 'Drop-off'; address: string; expanded: boolean; toggleHint?: boolean }) {
  return <View style={styles.routeRow}>
    <AddressIcon name={label === 'Pickup' ? 'pickup' : 'pin'} size={17} color={label === 'Pickup' ? 'primary' : 'danger'} />
    <View style={styles.address}><View style={styles.addressHeader}><Text variant="caption" color="textMuted">{label}</Text>{toggleHint ? <View style={styles.addressHint}><Text variant="caption" color="primary">{expanded ? 'Show less' : 'Full addresses'}</Text><View style={expanded ? styles.arrowUp : null}><RideIcon name="down" size={14} color="primary" /></View></View> : null}</View><Text variant="caption" numberOfLines={expanded ? undefined : 1} accessibilityLabel={`${label}: ${address}`}>{address}</Text></View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  controls: { position: 'absolute', top: 0, left: 16, right: 16 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8 },
  back: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  destination: { flex: 1, minWidth: 0, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, gap: 2 },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 6 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 4 },
  status: { alignItems: 'center' },
  courierStatus: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 6 },
  courierAnimation: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
  animation: { height: 124, alignItems: 'center', justifyContent: 'center' },
  statusCopy: { alignSelf: 'stretch', gap: 4 },
  courierCopy: { flex: 1, justifyContent: 'center' },
  centered: { textAlign: 'center' },
  route: { borderRadius: 14, padding: 10, gap: 8, marginTop: 10 },
  addressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  addressHint: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  arrowUp: { transform: [{ rotate: '180deg' }] },
  routeRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  address: { flex: 1, minWidth: 0 },
  parcel: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderRadius: 14, padding: 10, marginTop: 8 },
  parcelIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  parcelAction: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 4 },
  codeCard: { borderRadius: 12, padding: 10, marginTop: 10, gap: 6 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  code: { letterSpacing: 4, marginTop: 3, textAlign: 'center' },
  codeActionSpace: { width: 44 },
  share: { width: 44, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  codeHint: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  payment: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingVertical: 8 },
  courierPayment: { minHeight: 44 },
  paymentCopy: { flex: 1, minWidth: 0 },
  fare: { flexShrink: 1, textAlign: 'right' },
  footer: { paddingHorizontal: 16, paddingTop: 2, borderTopWidth: StyleSheet.hairlineWidth },
});
