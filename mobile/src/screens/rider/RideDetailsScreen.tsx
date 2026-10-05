import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text } from '@/components/common';
import { AppMap, RideConfirmationModal, type AppMapMarker } from '@/components/map';
import { nativeWindTheme, useTheme } from '@/constants/theme';
import { getTripEstimate, type TripEstimate } from '@/services/mapsService';
import { useMapStore } from '@/store/mapStore';
import { useTripStore } from '@/store/tripStore';
import { useWalletStore } from '@/store/walletStore';
import { formatNaira } from '@/services/paymentService';

type PaymentId = 'cash' | 'wallet';

const RIDE = { name: 'Ride', description: 'Dependable everyday rides in comfortable, mid-size cars.', seats: 4, badges: ['Recommended', 'Best value'] } as const;

const PAYMENT_OPTIONS = [
  { id: 'cash' as const, name: 'Cash', detail: 'Pay your driver after the ride', icon: '▣' },
  { id: 'wallet' as const, name: 'Rakky Ride wallet', detail: 'Balance: ₦0', icon: '◉' },
];

export function RideDetailsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const pickup = useMapStore((state) => state.pickupLocation);
  const dropoff = useMapStore((state) => state.dropoffLocation);
  const route = useMapStore((state) => state.routeCoordinates);
  const region = useMapStore((state) => state.cameraRegion);
  const [estimate, setEstimate] = useState<TripEstimate | null>(null);
  const [payment, setPayment] = useState<PaymentId>('cash');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const requestTrip=useTripStore(state=>state.request),requesting=useTripStore(state=>state.loading);
  const walletKobo=useWalletStore(state=>state.walletKobo),refreshWallet=useWalletStore(state=>state.refresh);
  const requestKey=useRef<string|null>(null);

  useEffect(() => {
    if (!pickup || !dropoff) return;
    void getTripEstimate(pickup, dropoff).then((value) => {
      setEstimate(value);
    }).catch(() => undefined);
  }, [dropoff, pickup]);
  useEffect(()=>{void refreshWallet();},[refreshWallet]);

  const confirmRequest=async()=>{if(!pickup||!dropoff)return;if(payment==='wallet'&&walletKobo<(estimate?.fareKobo??0)){setConfirmationOpen(false);router.push({pathname:'/account/[section]',params:{section:'top-up',target:'wallet'}});return;}setConfirmationOpen(false);requestKey.current??=`trip-${Date.now()}-${Math.random().toString(36).slice(2)}`;try{await requestTrip({pickup,dropoff,paymentMethod:payment},requestKey.current);void refreshWallet();router.replace('/ongoing-trip');}catch(reason){Alert.alert('Could not request ride',reason instanceof Error?reason.message:'Please try again.');}};

  const markers = useMemo<AppMapMarker[]>(() => [
    ...(pickup ? [{ ...pickup, id: 'pickup', kind: 'pickup' as const }] : []),
    ...(dropoff ? [{ ...dropoff, id: 'dropoff', kind: 'dropoff' as const }] : []),
  ], [dropoff, pickup]);
  const fare = estimate?.estimatedFare ?? 0;
  const selectedPayment = PAYMENT_OPTIONS.find((item) => item.id === payment) ?? PAYMENT_OPTIONS[0];
  const goBack = () => router.canGoBack() ? router.back() : router.replace('/ride-selection');

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

        <View className="mt-lg"><Text variant="caption" color="textMuted">Upfront fare</Text><Text variant="h2" className="mt-xs !text-[30px]">{estimate ? `₦${fare.toLocaleString()}` : 'Calculating…'}</Text><Text variant="caption" color="textMuted" className="mt-xs">This fixed fare is calculated securely by Rakky Ride.</Text></View>

        <View className="mt-lg rounded-xl border border-border p-md">
          <DetailRow label="Fare" value={estimate ? `₦${fare.toLocaleString()}` : 'Calculating…'} strong />
          <DetailRow label="Estimated distance" value={estimate ? `${estimate.distanceKm.toFixed(1)} km` : 'Calculating…'} />
          <DetailRow label="Estimated trip time" value={estimate ? `${Math.ceil(estimate.durationMin)} min` : 'Calculating…'} />
          <DetailRow label="Vehicle" value="Economy" />
          <DetailRow label="Seats" value={String(RIDE.seats)} last />
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel="Choose payment method" onPress={() => setPaymentOpen(true)} className="mt-md flex-row items-center rounded-xl border border-border p-md"><View className="h-10 w-10 items-center justify-center rounded-lg bg-successSoft"><Text color="success">{selectedPayment.icon}</Text></View><View className="ml-md flex-1"><Text variant="bodyMedium">{selectedPayment.name}</Text><Text variant="caption" color="textMuted">{payment==='wallet'?`Balance: ${formatNaira(walletKobo)}`:selectedPayment.detail}</Text></View><Text color="icon">›</Text></Pressable>
        <View className="mt-md rounded-xl bg-surfaceMuted p-md"><LocationRow icon="●" label="Pickup" value={pickup?.address ?? 'Pickup location'} /><View className="ml-[5px] h-5 w-px bg-borderStrong" /><LocationRow icon="■" label="Drop-off" value={dropoff?.address ?? 'Destination'} /></View>
        <Text variant="caption" color="textMuted" className="mt-md">The estimate may change if tolls, waiting time, or the route differs from the original trip.</Text>
      </ScrollView>
      <SafeAreaView edges={['bottom']} className="border-t border-border bg-surface px-xl pt-md"><Button label={`Request ride · ₦${fare.toLocaleString()}`} size="lg" fullWidth loading={requesting} disabled={!estimate} onPress={() => setConfirmationOpen(true)} /></SafeAreaView>
    </View>

    <Modal visible={paymentOpen} transparent animationType="slide" onRequestClose={() => setPaymentOpen(false)}><Pressable onPress={() => setPaymentOpen(false)} className="flex-1 justify-end" style={[nativeWindTheme[theme.scheme], { backgroundColor: theme.colors.overlay }]}><Pressable onPress={(event) => event.stopPropagation()} className="rounded-t-[28px] p-xl" style={{ backgroundColor: theme.colors.surface }}><View className="mb-md items-center"><View className="h-1 w-12 rounded-full bg-borderStrong" /></View><Text variant="h3" className="!text-[22px]">Choose payment</Text>{PAYMENT_OPTIONS.map((item) => <Pressable key={item.id} onPress={() => { if(item.id==='wallet'&&walletKobo<(estimate?.fareKobo??0)){setPaymentOpen(false);router.push({pathname:'/account/[section]',params:{section:'top-up',target:'wallet'}});return;}setPayment(item.id);setPaymentOpen(false); }} className="flex-row items-center gap-md border-b border-border py-md"><View className="h-11 w-11 items-center justify-center rounded-lg bg-surfaceMuted"><Text color={item.id === payment ? 'primary' : 'icon'}>{item.icon}</Text></View><View className="flex-1"><Text variant="bodyMedium">{item.name}</Text><Text variant="caption" color="textMuted">{item.id==='wallet'&&estimate?walletKobo<estimate.fareKobo?`Top up ${formatNaira(estimate.fareKobo-walletKobo)} to pay with wallet`:`Balance: ${formatNaira(walletKobo)}`:item.detail}</Text></View>{item.id === payment ? <Text color="primary">●</Text> : <Text color="icon">○</Text>}</Pressable>)}</Pressable></Pressable></Modal>
    <RideConfirmationModal visible={confirmationOpen} rideName={RIDE.name} fare={fare} etaMinutes={Math.max(3, Math.ceil((estimate?.durationMin ?? 8) * 0.35))} paymentName={selectedPayment.name} pickupAddress={pickup?.address ?? 'Pickup location'} dropoffAddress={dropoff?.address ?? 'Destination'} onClose={() => setConfirmationOpen(false)} onConfirm={() => void confirmRequest()} />
  </View>;
}

function DetailRow({ label, value, strong = false, last = false }: { label: string; value: string; strong?: boolean; last?: boolean }) {
  return <View className={`flex-row items-center justify-between py-sm ${last ? '' : 'border-b border-border'}`}><Text variant={strong ? 'bodyMedium' : 'caption'} color={strong ? 'text' : 'textMuted'}>{label}</Text><Text variant={strong ? 'bodyMedium' : 'caption'}>{value}</Text></View>;
}

function LocationRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return <View className="flex-row items-center gap-md"><Text color={label === 'Pickup' ? 'primary' : 'danger'}>{icon}</Text><View className="flex-1"><Text variant="caption" color="textMuted">{label}</Text><Text variant="bodyMedium" numberOfLines={2}>{value}</Text></View></View>;
}
