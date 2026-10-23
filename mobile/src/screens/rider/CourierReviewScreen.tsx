import { useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppMap, type AppMapMarker } from '@/components/map';
import { Button, Text } from '@/components/common';
import { AddressIcon } from '@/components/map/AddressIcon';
import { RideIcon } from '@/components/common/RideIcon';
import { borderWidths, radius, spacing, useTheme } from '@/constants/theme';
import { useCourierDraftStore } from '@/store/courierDraftStore';
import { useMapStore } from '@/store/mapStore';
import { useTripStore } from '@/store/tripStore';
import { useWalletStore } from '@/store/walletStore';
import { TripQuoteError } from '@/services/tripService';
import { useTripQuote } from '@/hooks/useTripQuote';
import { formatNaira } from '@/services/paymentService';
import { apiErrorMessage } from '@/lib/apiClient';

export function CourierReviewScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const draft = useCourierDraftStore((state) => state.draft);
  const clearDraft = useCourierDraftStore((state) => state.clearDraft);
  const pickup = useMapStore((state) => state.pickupLocation);
  const dropoff = useMapStore((state) => state.dropoffLocation);
  const region = useMapStore((state) => state.cameraRegion);
  const route = useMapStore((state) => state.routeCoordinates);
  const request = useTripStore((state) => state.request);
  const requesting = useTripStore((state) => state.loading);
  const walletKobo = useWalletStore((state) => state.walletKobo);
  const refreshWallet = useWalletStore((state) => state.refresh);
  const { estimate, error: quoteError, fareChange, clearFareChange, retry: retryQuote, refresh: refreshQuote, ensureFresh } = useTripQuote(pickup, dropoff, 'courier');
  const [error, setError] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const submissionInFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { void refreshWallet(); }, [refreshWallet]);
  const markers = useMemo<AppMapMarker[]>(() => [
    ...(pickup ? [{ ...pickup, id: 'pickup', kind: 'pickup' as const }] : []),
    ...(dropoff ? [{ ...dropoff, id: 'dropoff', kind: 'dropoff' as const }] : []),
  ], [pickup, dropoff]);
  const submit = async () => {
    if (!pickup || !dropoff || !draft || !estimate || requesting || submissionInFlight.current) return;
    submissionInFlight.current = true;
    setSubmitting(true);
    setError(null);
    const approvedFareKobo = estimate.fareKobo;
    key.current ??= `courier-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      let quote = await ensureFresh();
      if (quote.fareKobo !== approvedFareKobo) return;
      if (walletKobo < quote.fareKobo) { setError('Top up your wallet to cover the updated fare.'); return; }
      const send = (quoteId: string) => request({ pickup, dropoff, quoteId, paymentMethod: 'wallet', serviceType: 'courier', courierDetails: draft }, key.current!);
      try { await send(quote.quoteId); }
      catch (reason) {
        if (!(reason instanceof TripQuoteError)) throw reason;
        quote = await refreshQuote();
        if (quote.fareKobo !== approvedFareKobo) return;
        await send(quote.quoteId);
      }
      clearDraft();
      void refreshWallet();
      router.replace('/ongoing-trip');
    } catch (reason) {
      setError(apiErrorMessage(reason));
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  };
  if (!draft || !pickup || !dropoff) return <SafeAreaView className="flex-1 items-center justify-center bg-background px-xl"><Text variant="h3">Delivery details are missing</Text><Text color="textMuted" className="mt-sm text-center">Start with the package details, then choose pickup and drop-off.</Text><Button label="Start again" className="mt-lg" onPress={() => router.replace('/courier')} /></SafeAreaView>;
  const editDetails = () => router.push({ pathname: '/courier', params: { review: '1' } });
  return <View style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={styles.map}><AppMap region={region} markers={markers} polyline={route} fitRouteOnChange mapPadding={{ top: 64, right: 24, bottom: 48, left: 24 }} /></View>
    <SafeAreaView edges={['top']} style={styles.backArea}><Pressable accessibilityRole="button" accessibilityLabel="Edit delivery addresses" onPress={() => router.replace({ pathname: '/set-destination', params: { service: 'courier' } })} style={[styles.back, { backgroundColor: colors.surface }]}><AddressIcon name="back" size={19} /></Pressable></SafeAreaView>
    <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
      <View style={styles.handleArea}><View style={[styles.handle, { backgroundColor: colors.borderStrong }]} /></View>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heading}><Text variant="bodyMedium" accessibilityRole="header" style={styles.copy}>Review delivery</Text><View style={styles.inline}><RideIcon name="package" size={16} color="primary" /><Text variant="button" color="primary">Courier</Text></View></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit package details" onPress={editDetails} style={[styles.packageCard, { borderColor: colors.border }]}>
          <Image source={require('@/assets/images/home-v2/courier.png')} contentFit="contain" style={styles.artwork} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          <View style={styles.copy}><Text variant="button" numberOfLines={2}>{draft.description}</Text><Text variant="caption" color="textMuted">{draft.weightKg} kg · Sealed package</Text></View>
          <View style={[styles.editIcon, { backgroundColor: colors.surfaceMuted }]}><AddressIcon name="edit" size={16} /></View>
        </Pressable>

        <View style={styles.route}>
          <View style={styles.routeStop}><View style={styles.pickupMarker}><AddressIcon name="pickup" size={15} color="primary" /><View style={[styles.connector, { borderColor: colors.borderStrong }]} /></View><View style={styles.copy}><Text variant="caption" color="textMuted">Pickup</Text><Text variant="caption">{pickup.address}</Text>{draft.pickupInstructions ? <Text variant="caption" color="textMuted" style={styles.note}>{draft.pickupInstructions}</Text> : null}</View></View>
          <View style={styles.routeStop}><AddressIcon name="pin" size={15} /><View style={styles.copy}><Text variant="caption" color="textMuted">Drop-off</Text><Text variant="caption">{dropoff.address}</Text>{draft.dropoffInstructions ? <Text variant="caption" color="textMuted" style={styles.note}>{draft.dropoffInstructions}</Text> : null}</View></View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit recipient details" onPress={editDetails} style={[styles.recipient, { borderTopColor: colors.border }]}>
          <RideIcon name="passenger" size={18} /><View style={styles.copy}><Text variant="button">{draft.recipientName}</Text><Text variant="caption" color="textMuted">{draft.recipientPhone}</Text></View><RideIcon name="chevron" size={16} color="textMuted" />
        </Pressable>
        <View style={[styles.codeNotice, { backgroundColor: colors.primarySoft }]}><RideIcon name="safety" size={21} color="primary" /><View style={styles.copy}><Text variant="button" color="primary">Delivery code</Text><Text variant="caption" color="textMuted" style={styles.note}>After booking, share the 6-digit code with your recipient.</Text></View></View>
        {fareChange ? <Text accessibilityRole="alert" variant="caption" color="danger">Fare changed from {formatNaira(fareChange.previousFareKobo)} to {formatNaira(fareChange.newFareKobo)}. Review the new price before sending.</Text> : null}
        {error || quoteError ? <Text accessibilityRole="alert" variant="caption" color="danger">{error ?? quoteError}</Text> : null}
        {quoteError ? <Button label="Retry fare estimate" size="sm" variant="outline" fullWidth onPress={retryQuote} /> : null}
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={[styles.footer, { borderTopColor: colors.border }]}>
        <View style={styles.fareRow}><Text variant="caption" color="textMuted">Delivery fare</Text><Text variant="bodyMedium" accessibilityLiveRegion="polite">{estimate ? formatNaira(estimate.fareKobo) : 'Calculating…'}</Text></View>
        <View style={styles.inline}><RideIcon name="wallet" size={16} color="textMuted" /><Text variant="caption" color="textMuted" style={styles.copy}>Wallet balance: {formatNaira(walletKobo)}</Text></View>
        <Text variant="caption" color="textMuted">Fare held when you place the order.</Text>
        {estimate && walletKobo < estimate.fareKobo ? <Button label={`Top up ${formatNaira(estimate.fareKobo - walletKobo)}`} size="sm" variant="outline" fullWidth onPress={() => router.push({ pathname: '/account/[section]', params: { section: 'top-up', target: 'wallet' } })} /> : null}
        <Button label={estimate ? `Send package · ${formatNaira(estimate.fareKobo)}` : 'Calculating delivery'} size="sm" className="min-h-12 mt-xs" fullWidth loading={requesting || submitting} disabled={!estimate || walletKobo < estimate.fareKobo} onPress={() => { clearFareChange(); void submit(); }} rightIcon={<View style={styles.forward}><AddressIcon name="back" size={17} color="textInverse" /></View>} />
      </SafeAreaView>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, copy: { flex: 1, minWidth: 0 },
  map: { height: '38%' }, backArea: { position: 'absolute', left: spacing.xl, top: 0, paddingTop: spacing.sm },
  back: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '68%', borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  handleArea: { alignItems: 'center', paddingVertical: spacing.sm }, handle: { width: 36, height: 4, borderRadius: radius.full },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.xs, paddingBottom: spacing.md, gap: spacing.md },
  heading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  packageCard: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: borderWidths.divider, borderRadius: radius.lg, padding: spacing.sm },
  artwork: { width: 40, height: 40 }, editIcon: { width: 36, height: 36, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  route: { gap: spacing.md, paddingHorizontal: spacing.xs }, routeStop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  pickupMarker: { alignSelf: 'stretch', width: 15, alignItems: 'center', gap: spacing.xs }, connector: { flex: 1, borderLeftWidth: 1, borderStyle: 'dashed', marginBottom: -spacing.sm },
  recipient: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderTopWidth: borderWidths.divider, paddingTop: spacing.sm },
  codeNotice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg }, note: { marginTop: spacing.xs },
  footer: { borderTopWidth: borderWidths.divider, paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.xs },
  fareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }, forward: { transform: [{ rotate: '180deg' }] },
});
