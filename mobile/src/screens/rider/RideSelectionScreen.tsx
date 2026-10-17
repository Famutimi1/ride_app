import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text } from '@/components/common';
import { AppMap, RideConfirmationModal, type AppMapMarker } from '@/components/map';
import { nativeWindTheme, useTheme } from '@/constants/theme';
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
  { id: 'economy' as const, name: 'Ride', description: 'Affordable everyday rides', seats: 4, badge: 'Recommended', icon: '🚙' },
] as const;

const PAYMENTS = [
  { id: 'cash' as const, name: 'Cash', detail: 'Pay the driver after your trip', icon: '▣' },
  { id: 'wallet' as const, name: 'Rakky Ride wallet', detail: 'Available balance: ₦0', icon: '◉' },
] as const;

export function RideSelectionScreen() {
  const router = useRouter();
  const { scheduledAt } = useLocalSearchParams<{ scheduledAt?: string }>();
  const scheduledTime = scheduledAt ? new Date(scheduledAt).getTime() : null;
  const theme = useTheme();
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
  const selected = RIDES.find((ride) => ride.id === selectedRide) ?? RIDES[0];
  const selectedPayment = PAYMENTS.find((item) => item.id === payment) ?? PAYMENTS[0];
  const fareLabel = estimate ? formatNaira(estimate.fareKobo) : quoteError ? 'Fare unavailable' : 'Calculating…';
  const goBack = () => router.canGoBack() ? router.back() : router.replace('/set-destination');

  return <View className="flex-1 bg-background">
    <View className="h-[43%]"><AppMap region={region} markers={markers} polyline={route} fitRouteOnChange mapPadding={{ top: 90, right: 36, bottom: 80, left: 36 }} /></View>
    <SafeAreaView edges={['top']} className="absolute left-lg right-lg top-0">
      <View className="flex-row items-center rounded-xl bg-surface p-sm shadow-md">
        <Pressable onPress={goBack} className="h-10 w-10 items-center justify-center"><Text variant="h3">×</Text></Pressable>
        <View className="mx-sm h-8 w-px bg-border" />
        <Text variant="bodyMedium" className="flex-1" numberOfLines={1} ellipsizeMode="tail">{pickup?.address ?? 'Pickup'} → {dropoff?.address ?? 'Destination'}</Text>
        <Pressable className="h-10 w-10 items-center justify-center"><Text variant="h3">＋</Text></Pressable>
      </View>
    </SafeAreaView>

    <View className="absolute bottom-0 left-0 right-0 h-[62%] overflow-hidden rounded-t-[28px] bg-surface shadow-lg">
      <View className="items-center pb-sm pt-md"><View className="h-1 w-12 rounded-full bg-borderStrong" /></View>
      <View className="px-xl pb-sm"><Text variant="h3" className="!text-[21px]">Choose your ride</Text><Text variant="caption" color="textMuted">{scheduledTime ? `Pickup ${formatScheduledTime(scheduledTime, { dateStyle: 'medium', timeStyle: 'short' })} WAT` : 'Arrival time is available after a driver accepts'}</Text>{routeFailed ? <Pressable accessibilityRole="button" onPress={() => setRouteAttempt((attempt) => attempt + 1)} className="py-sm"><Text color="primary">Map route unavailable. Retry route</Text></Pressable> : null}{quoteError ? <Pressable accessibilityRole="button" onPress={retryQuote} className="py-sm"><Text color="danger">{quoteError} · Retry fare</Text></Pressable> : null}{fareChange ? <Text variant="caption" color="danger" className="py-sm">Fare changed from {formatNaira(fareChange.previousFareKobo)} to {formatNaira(fareChange.newFareKobo)}. Review the new price before booking.</Text> : null}</View>

      <ScrollView className="flex-1" contentContainerClassName="px-lg pb-md" showsVerticalScrollIndicator={false}>
        {RIDES.map((ride) => {
          const active = ride.id === selectedRide;
          return <Pressable key={ride.id} onPress={() => {
            if (active) router.push({ pathname: '/ride-details', params: { ride: ride.id, ...(scheduledAt ? { scheduledAt } : {}) } });
            else setSelectedRide(ride.id);
          }} className={`mb-sm flex-row items-center rounded-xl border-2 px-md py-sm ${active ? 'border-primary bg-primarySoft' : 'border-transparent bg-surfaceMuted'}`}>
            <View className="h-14 w-16 items-center justify-center rounded-lg bg-surface"><Text variant="h3" className="!text-[29px]">{ride.icon}</Text></View>
            <View className="ml-md flex-1"><View className="flex-row items-center gap-sm"><Text variant="bodyMedium">{ride.name}</Text>{active ? <View className="rounded-sm bg-primary px-xs"><Text variant="caption" color="textInverse" className="!text-[10px]">{ride.badge}</Text></View> : null}</View><Text variant="caption" color="textMuted">{scheduledAt ? 'Scheduled pickup' : 'Driver matched after request'} · ♙ {ride.seats} seats</Text><Text variant="caption" color="textMuted" numberOfLines={1}>{ride.description}</Text></View>
            <View className="items-end"><Text variant="bodyMedium">{fareLabel}</Text><Text variant="caption" color="textMuted">Quoted fare</Text></View>
          </Pressable>;
        })}
      </ScrollView>

      <SafeAreaView edges={['bottom']} className="border-t border-border bg-surface px-lg pt-sm">
        <Pressable onPress={() => setPaymentOpen(true)} className="mb-sm flex-row items-center justify-between px-sm py-xs"><View className="flex-row items-center gap-md"><View className="h-9 w-9 items-center justify-center rounded-lg bg-successSoft"><Text color="success">{selectedPayment.icon}</Text></View><View><Text variant="bodyMedium">{selectedPayment.name}</Text><Text variant="caption" color="textMuted">{payment==='wallet'?`Balance: ${formatNaira(walletKobo)}`:'Payment method'}</Text></View></View><Text color="icon">⌄</Text></Pressable>
        <Button label={`${scheduledAt ? 'Schedule' : 'Request'} ${selected.name} · ${fareLabel}`} size="lg" fullWidth loading={requesting || submitting} disabled={!estimate} onPress={() => { clearFareChange(); setConfirmationOpen(true); }} />
      </SafeAreaView>
    </View>

    <Modal visible={paymentOpen} transparent animationType="slide" onRequestClose={() => setPaymentOpen(false)}>
      <Pressable onPress={() => setPaymentOpen(false)} className="flex-1 justify-end" style={[nativeWindTheme[theme.scheme], { backgroundColor: theme.colors.overlay }]}>
        <Pressable onPress={(event) => event.stopPropagation()} className="rounded-t-[28px] p-xl" style={{ backgroundColor: theme.colors.surface }}>
          <View className="mb-md items-center"><View className="h-1 w-12 rounded-full bg-borderStrong" /></View>
          <Text variant="h3" className="!text-[22px]">Payment method</Text>
          <Text variant="caption" color="textMuted" className="mb-md">Choose how you want to pay for this ride.</Text>
          {PAYMENTS.map((item) => <Pressable key={item.id} onPress={() => { if(item.id==='wallet'&&!scheduledAt&&walletKobo<(estimate?.fareKobo??0)){setPaymentOpen(false);router.push({pathname:'/account/[section]',params:{section:'top-up',target:'wallet'}});return;}setPayment(item.id);setPaymentOpen(false); }} className="flex-row items-center gap-md border-b border-border py-md">
            <View className="h-11 w-11 items-center justify-center rounded-lg bg-surfaceMuted"><Text color={item.id === payment ? 'primary' : 'icon'}>{item.icon}</Text></View><View className="flex-1"><Text variant="bodyMedium">{item.name}</Text><Text variant="caption" color="textMuted">{item.id==='wallet'&&scheduledAt?'Funds must be available when driver search begins':item.id==='wallet'&&estimate?walletKobo<estimate.fareKobo?`Top up ${formatNaira(estimate.fareKobo-walletKobo)} to pay with wallet`:`Available balance: ${formatNaira(walletKobo)}`:item.detail}</Text></View><View className={`h-5 w-5 items-center justify-center rounded-full border ${item.id === payment ? 'border-primary' : 'border-borderStrong'}`}>{item.id === payment ? <View className="h-3 w-3 rounded-full bg-primary" /> : null}</View>
          </Pressable>)}
        </Pressable>
      </Pressable>
    </Modal>
    <RideConfirmationModal visible={confirmationOpen} loading={submitting} rideName={selected.name} fareKobo={estimate?.fareKobo ?? null} paymentName={selectedPayment.name} pickupAddress={pickup?.address ?? 'Pickup location'} dropoffAddress={dropoff?.address ?? 'Destination'} scheduledAt={scheduledAt} onClose={() => setConfirmationOpen(false)} onConfirm={() => void confirmRequest()} />
  </View>;
}
