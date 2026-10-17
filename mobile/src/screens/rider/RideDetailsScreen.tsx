import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text } from '@/components/common';
import { AppMap, RideConfirmationModal, type AppMapMarker } from '@/components/map';
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

const RIDE = { name: 'Ride', description: 'Dependable everyday rides in comfortable, mid-size cars.', seats: 4, badges: ['Recommended', 'Best value'] } as const;

const PAYMENT_OPTIONS = [
  { id: 'cash' as const, name: 'Cash', detail: 'Pay your driver after the ride', icon: '▣' },
  { id: 'wallet' as const, name: 'Rakky Ride wallet', detail: 'Balance: ₦0', icon: '◉' },
];

export function RideDetailsScreen() {
  const router = useRouter();
  const { scheduledAt } = useLocalSearchParams<{ scheduledAt?: string }>();
  const scheduledTime = scheduledAt ? new Date(scheduledAt).getTime() : null;
  const theme = useTheme();
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

  return <View className="flex-1 bg-background">
    <View className="h-[30%]"><AppMap region={region} markers={markers} polyline={route} mapPadding={{ top: 60, right: 30, bottom: 45, left: 30 }} /></View>
    <SafeAreaView edges={['top']} className="absolute left-lg top-0"><Pressable onPress={goBack} className="h-12 w-12 items-center justify-center rounded-full bg-surface shadow-md"><Text variant="h3">×</Text></Pressable></SafeAreaView>

    <View className="absolute bottom-0 left-0 right-0 h-[76%] overflow-hidden rounded-t-[28px] bg-surface shadow-lg">
      <View className="items-center pb-sm pt-md"><View className="h-1 w-12 rounded-full bg-borderStrong" /></View>
      <ScrollView className="flex-1" contentContainerClassName="px-xl pb-xl" showsVerticalScrollIndicator={false}>
        <View className="h-28 items-center justify-center rounded-2xl bg-surfaceMuted">
          <Image source={require('../../../assets/images/onboarding-ride.svg')} contentFit="contain" style={{ width: 190, height: 105 }} />
        </View>
        <View className="mt-md flex-row items-center gap-sm"><Text variant="h3" className="!text-[24px]">{RIDE.name}</Text>{RIDE.badges.map((badge) => <View key={badge} className="rounded-sm bg-success px-sm py-xs"><Text variant="caption" color="textInverse" className="!text-[10px]">{badge}</Text></View>)}</View>
        <Text color="textMuted" className="mt-xs">{RIDE.description}</Text>

        <View className="mt-lg"><Text variant="caption" color="textMuted">Quoted fare</Text><Text variant="h2" className="mt-xs !text-[30px]">{fareLabel}</Text><Text variant="caption" color="textMuted" className="mt-xs">Calculated by Rakky Ride for this route.</Text>{quoteError ? <Pressable accessibilityRole="button" onPress={retryQuote} className="py-sm"><Text color="danger">{quoteError} · Retry fare</Text></Pressable> : null}{fareChange ? <Text variant="caption" color="danger" className="mt-sm">Fare changed from {formatNaira(fareChange.previousFareKobo)} to {formatNaira(fareChange.newFareKobo)}. Review the new price before booking.</Text> : null}</View>

        <View className="mt-lg rounded-xl border border-border p-md">
          <DetailRow label="Fare" value={fareLabel} strong />
          <DetailRow label="Estimated distance" value={estimate ? `${estimate.distanceKm.toFixed(1)} km` : 'Calculating…'} />
          <DetailRow label="Estimated trip time" value={estimate ? `${Math.ceil(estimate.durationMin)} min` : 'Calculating…'} />
          <DetailRow label="Vehicle" value="Economy" />
          <DetailRow label="Seats" value={String(RIDE.seats)} last />
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel="Choose payment method" onPress={() => setPaymentOpen(true)} className="mt-md flex-row items-center rounded-xl border border-border p-md"><View className="h-10 w-10 items-center justify-center rounded-lg bg-successSoft"><Text color="success">{selectedPayment.icon}</Text></View><View className="ml-md flex-1"><Text variant="bodyMedium">{selectedPayment.name}</Text><Text variant="caption" color="textMuted">{payment==='wallet'?`Balance: ${formatNaira(walletKobo)}`:selectedPayment.detail}</Text></View><Text color="icon">›</Text></Pressable>
        <View className="mt-md rounded-xl bg-surfaceMuted p-md"><LocationRow icon="●" label="Pickup" value={pickup?.address ?? 'Pickup location'} /><View className="ml-[5px] h-5 w-px bg-borderStrong" /><LocationRow icon="■" label="Drop-off" value={dropoff?.address ?? 'Destination'} /></View>
        {scheduledTime ? <Text variant="bodyMedium" color="primary" className="mt-md">Pickup {formatScheduledTime(scheduledTime, { dateStyle: 'medium', timeStyle: 'short' })} WAT</Text> : null}
        <Text variant="caption" color="textMuted" className="mt-md">{scheduledAt ? 'We start looking for a driver about 5 minutes before pickup. A driver is not guaranteed until one accepts.' : 'Arrival time is available after a driver accepts your request.'}</Text>
      </ScrollView>
      <SafeAreaView edges={['bottom']} className="border-t border-border bg-surface px-xl pt-md"><Button label={`${scheduledAt ? 'Schedule' : 'Request'} ride · ${fareLabel}`} size="lg" fullWidth loading={requesting || submitting} disabled={!estimate} onPress={() => { clearFareChange(); setConfirmationOpen(true); }} /></SafeAreaView>
    </View>

    <Modal visible={paymentOpen} transparent animationType="slide" onRequestClose={() => setPaymentOpen(false)}><Pressable onPress={() => setPaymentOpen(false)} className="flex-1 justify-end" style={[nativeWindTheme[theme.scheme], { backgroundColor: theme.colors.overlay }]}><Pressable onPress={(event) => event.stopPropagation()} className="rounded-t-[28px] p-xl" style={{ backgroundColor: theme.colors.surface }}><View className="mb-md items-center"><View className="h-1 w-12 rounded-full bg-borderStrong" /></View><Text variant="h3" className="!text-[22px]">Choose payment</Text>{PAYMENT_OPTIONS.map((item) => <Pressable key={item.id} onPress={() => { if(item.id==='wallet'&&!scheduledAt&&walletKobo<(estimate?.fareKobo??0)){setPaymentOpen(false);router.push({pathname:'/account/[section]',params:{section:'top-up',target:'wallet'}});return;}setPayment(item.id);setPaymentOpen(false); }} className="flex-row items-center gap-md border-b border-border py-md"><View className="h-11 w-11 items-center justify-center rounded-lg bg-surfaceMuted"><Text color={item.id === payment ? 'primary' : 'icon'}>{item.icon}</Text></View><View className="flex-1"><Text variant="bodyMedium">{item.name}</Text><Text variant="caption" color="textMuted">{item.id==='wallet'&&scheduledAt?'Funds must be available when driver search begins':item.id==='wallet'&&estimate?walletKobo<estimate.fareKobo?`Top up ${formatNaira(estimate.fareKobo-walletKobo)} to pay with wallet`:`Balance: ${formatNaira(walletKobo)}`:item.detail}</Text></View>{item.id === payment ? <Text color="primary">●</Text> : <Text color="icon">○</Text>}</Pressable>)}</Pressable></Pressable></Modal>
    <RideConfirmationModal visible={confirmationOpen} loading={submitting} rideName={RIDE.name} fareKobo={estimate?.fareKobo ?? null} paymentName={selectedPayment.name} pickupAddress={pickup?.address ?? 'Pickup location'} dropoffAddress={dropoff?.address ?? 'Destination'} scheduledAt={scheduledAt} onClose={() => setConfirmationOpen(false)} onConfirm={() => void confirmRequest()} />
  </View>;
}

function DetailRow({ label, value, strong = false, last = false }: { label: string; value: string; strong?: boolean; last?: boolean }) {
  return <View className={`flex-row items-center justify-between py-sm ${last ? '' : 'border-b border-border'}`}><Text variant={strong ? 'bodyMedium' : 'caption'} color={strong ? 'text' : 'textMuted'}>{label}</Text><Text variant={strong ? 'bodyMedium' : 'caption'}>{value}</Text></View>;
}

function LocationRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return <View className="flex-row items-center gap-md"><Text color={label === 'Pickup' ? 'primary' : 'danger'}>{icon}</Text><View className="flex-1"><Text variant="caption" color="textMuted">{label}</Text><Text variant="bodyMedium" numberOfLines={2}>{value}</Text></View></View>;
}
