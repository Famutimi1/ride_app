import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppMap, type AppMapMarker } from '@/components/map';
import { Button, Text } from '@/components/common';
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
  return <View className="flex-1 bg-background">
    <View className="h-[38%]"><AppMap region={region} markers={markers} polyline={route} mapPadding={{ top: 72, right: 24, bottom: 72, left: 24 }} /></View>
    <SafeAreaView edges={['top']} className="absolute left-lg right-lg top-0"><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.replace({ pathname: '/set-destination', params: { service: 'courier' } })} className="h-12 w-12 items-center justify-center rounded-full bg-surface shadow-md"><Text variant="h3">←</Text></Pressable></SafeAreaView>
    <View className="absolute bottom-0 left-0 right-0 h-[67%] rounded-t-[28px] bg-surface shadow-lg"><View className="items-center py-md"><View className="h-1 w-12 rounded-full bg-borderStrong" /></View><ScrollView contentContainerClassName="px-xl pb-xl" showsVerticalScrollIndicator={false}>
      <Text variant="caption" color="primary" className="uppercase tracking-widest">Courier delivery</Text><Text variant="h2" className="mt-xs">Review your package</Text>
      <View className="mt-lg rounded-xl bg-surfaceMuted p-md"><Text variant="bodyMedium">📦 {draft.description}</Text><Text variant="caption" color="textMuted">{draft.weightKg} kg · Sealed package</Text></View>
      <View className="mt-md rounded-xl bg-surfaceMuted p-md"><Text variant="caption" color="textMuted">Collect from sender</Text><Text variant="bodyMedium">{pickup.address}</Text><Text variant="caption" color="textMuted" className="mt-sm">Deliver to {draft.recipientName} · {draft.recipientPhone}</Text><Text variant="bodyMedium">{dropoff.address}</Text></View>
      <View className="mt-md rounded-xl bg-primarySoft p-md"><Text variant="caption" color="primary">Handoff code</Text><Text>After booking, share the six-digit code shown in the delivery screen with {draft.recipientName}. The driver needs it to confirm delivery.</Text></View>
      <View className="mt-md flex-row justify-between"><Text>Delivery fare</Text><Text variant="h3">{estimate ? formatNaira(estimate.fareKobo) : 'Calculating…'}</Text></View><Text variant="caption" color="textMuted">Wallet balance: {formatNaira(walletKobo)}. The fare is held when you place the order.</Text>
      {fareChange ? <Text variant="caption" color="danger" className="mt-sm">Fare changed from {formatNaira(fareChange.previousFareKobo)} to {formatNaira(fareChange.newFareKobo)}. Review the new price before sending.</Text> : null}
      {estimate && walletKobo < estimate.fareKobo ? <Button label={`Top up ${formatNaira(estimate.fareKobo - walletKobo)}`} variant="outline" fullWidth className="mt-md" onPress={() => router.push({ pathname: '/account/[section]', params: { section: 'top-up', target: 'wallet' } })} /> : null}
      {error || quoteError ? <Text variant="caption" color="danger" className="mt-md">{error ?? quoteError}</Text> : null}
      {quoteError ? <Button label="Retry fare estimate" variant="outline" fullWidth className="mt-md" onPress={retryQuote} /> : null}
      <Button label={estimate ? `Send package · ${formatNaira(estimate.fareKobo)}` : 'Calculating delivery'} fullWidth className="mt-lg" loading={requesting || submitting} disabled={!estimate || walletKobo < estimate.fareKobo} onPress={() => { clearFareChange(); void submit(); }} />
    </ScrollView></View>
  </View>;
}
