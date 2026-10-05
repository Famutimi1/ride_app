import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, View } from 'react-native';
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

type RideId = 'economy';
type PaymentId = 'cash' | 'wallet';

const RIDES = [
  { id: 'economy' as const, name: 'Ride', description: 'Affordable everyday rides', seats: 4, etaOffset: 0, multiplier: 1, badge: 'Recommended', icon: '🚙' },
] as const;

const PAYMENTS = [
  { id: 'cash' as const, name: 'Cash', detail: 'Pay the driver after your trip', icon: '▣' },
  { id: 'wallet' as const, name: 'Rakky Ride wallet', detail: 'Available balance: ₦0', icon: '◉' },
] as const;

export function RideSelectionScreen() {
  const router = useRouter();
  const theme = useTheme();
  const pickup = useMapStore((state) => state.pickupLocation);
  const dropoff = useMapStore((state) => state.dropoffLocation);
  const route = useMapStore((state) => state.routeCoordinates);
  const region = useMapStore((state) => state.cameraRegion);
  const [selectedRide, setSelectedRide] = useState<RideId>('economy');
  const [payment, setPayment] = useState<PaymentId>('cash');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [estimate, setEstimate] = useState<TripEstimate | null>(null);
  const requestTrip=useTripStore(state=>state.request),requesting=useTripStore(state=>state.loading);
  const walletKobo=useWalletStore(state=>state.walletKobo),refreshWallet=useWalletStore(state=>state.refresh);
  const requestKey=useRef<string|null>(null);

  useEffect(() => {
    if (!pickup || !dropoff) return;
    void getTripEstimate(pickup, dropoff).then(setEstimate).catch(() => setEstimate(null));
  }, [dropoff, pickup]);
  useEffect(()=>{void refreshWallet();},[refreshWallet]);

  const confirmRequest=async()=>{if(!pickup||!dropoff)return;if(payment==='wallet'&&walletKobo<(estimate?.fareKobo??0)){setConfirmationOpen(false);router.push({pathname:'/account/[section]',params:{section:'top-up',target:'wallet'}});return;}setConfirmationOpen(false);requestKey.current??=`trip-${Date.now()}-${Math.random().toString(36).slice(2)}`;try{await requestTrip({pickup,dropoff,paymentMethod:payment},requestKey.current);void refreshWallet();router.replace('/ongoing-trip');}catch(reason){Alert.alert('Could not request ride',reason instanceof Error?reason.message:'Please try again.');}};

  const markers = useMemo<AppMapMarker[]>(() => [
    ...(pickup ? [{ ...pickup, id: 'pickup', kind: 'pickup' as const }] : []),
    ...(dropoff ? [{ ...dropoff, id: 'dropoff', kind: 'dropoff' as const }] : []),
  ], [dropoff, pickup]);
  const selected = RIDES.find((ride) => ride.id === selectedRide) ?? RIDES[0];
  const selectedPayment = PAYMENTS.find((item) => item.id === payment) ?? PAYMENTS[0];
  const baseFare = estimate?.estimatedFare ?? 3200;
  const eta = Math.max(3, Math.ceil((estimate?.durationMin ?? 8) * 0.35));
  const fareFor = (multiplier: number) => Math.ceil(baseFare * multiplier / 50) * 50;
  const goBack = () => router.canGoBack() ? router.back() : router.replace('/set-destination');

  return <View className="flex-1 bg-background">
    <View className="h-[43%]"><AppMap region={region} markers={markers} polyline={route} mapPadding={{ top: 90, right: 36, bottom: 80, left: 36 }} /></View>
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
      <View className="px-xl pb-sm"><Text variant="h3" className="!text-[21px]">Choose your ride</Text><Text variant="caption" color="textMuted">Pickup in approximately {eta} min · upfront price shown</Text></View>

      <ScrollView className="flex-1" contentContainerClassName="px-lg pb-md" showsVerticalScrollIndicator={false}>
        {RIDES.map((ride) => {
          const active = ride.id === selectedRide;
          const displayedFare = fareFor(ride.multiplier);
          return <Pressable key={ride.id} onPress={() => {
            if (active) router.push({ pathname: '/ride-details', params: { ride: ride.id } });
            else setSelectedRide(ride.id);
          }} className={`mb-sm flex-row items-center rounded-xl border-2 px-md py-sm ${active ? 'border-primary bg-primarySoft' : 'border-transparent bg-surfaceMuted'}`}>
            <View className="h-14 w-16 items-center justify-center rounded-lg bg-surface"><Text variant="h3" className="!text-[29px]">{ride.icon}</Text></View>
            <View className="ml-md flex-1"><View className="flex-row items-center gap-sm"><Text variant="bodyMedium">{ride.name}</Text>{active ? <View className="rounded-sm bg-primary px-xs"><Text variant="caption" color="textInverse" className="!text-[10px]">{ride.badge}</Text></View> : null}</View><Text variant="caption" color="textMuted">{eta + ride.etaOffset} min · ♙ {ride.seats} seats</Text><Text variant="caption" color="textMuted" numberOfLines={1}>{ride.description}</Text></View>
            <View className="items-end"><Text variant="bodyMedium">₦{displayedFare.toLocaleString()}</Text><Text variant="caption" color="textMuted">Upfront fare</Text></View>
          </Pressable>;
        })}
      </ScrollView>

      <SafeAreaView edges={['bottom']} className="border-t border-border bg-surface px-lg pt-sm">
        <Pressable onPress={() => setPaymentOpen(true)} className="mb-sm flex-row items-center justify-between px-sm py-xs"><View className="flex-row items-center gap-md"><View className="h-9 w-9 items-center justify-center rounded-lg bg-successSoft"><Text color="success">{selectedPayment.icon}</Text></View><View><Text variant="bodyMedium">{selectedPayment.name}</Text><Text variant="caption" color="textMuted">{payment==='wallet'?`Balance: ${formatNaira(walletKobo)}`:'Payment method'}</Text></View></View><Text color="icon">⌄</Text></Pressable>
        <Button label={`Request ${selected.name} · ₦${fareFor(selected.multiplier).toLocaleString()}`} size="lg" fullWidth loading={requesting} disabled={!estimate} onPress={() => setConfirmationOpen(true)} />
      </SafeAreaView>
    </View>

    <Modal visible={paymentOpen} transparent animationType="slide" onRequestClose={() => setPaymentOpen(false)}>
      <Pressable onPress={() => setPaymentOpen(false)} className="flex-1 justify-end" style={[nativeWindTheme[theme.scheme], { backgroundColor: theme.colors.overlay }]}>
        <Pressable onPress={(event) => event.stopPropagation()} className="rounded-t-[28px] p-xl" style={{ backgroundColor: theme.colors.surface }}>
          <View className="mb-md items-center"><View className="h-1 w-12 rounded-full bg-borderStrong" /></View>
          <Text variant="h3" className="!text-[22px]">Payment method</Text>
          <Text variant="caption" color="textMuted" className="mb-md">Choose how you want to pay for this ride.</Text>
          {PAYMENTS.map((item) => <Pressable key={item.id} onPress={() => { if(item.id==='wallet'&&walletKobo<(estimate?.fareKobo??0)){setPaymentOpen(false);router.push({pathname:'/account/[section]',params:{section:'top-up',target:'wallet'}});return;}setPayment(item.id);setPaymentOpen(false); }} className="flex-row items-center gap-md border-b border-border py-md">
            <View className="h-11 w-11 items-center justify-center rounded-lg bg-surfaceMuted"><Text color={item.id === payment ? 'primary' : 'icon'}>{item.icon}</Text></View><View className="flex-1"><Text variant="bodyMedium">{item.name}</Text><Text variant="caption" color="textMuted">{item.id==='wallet'&&estimate?walletKobo<estimate.fareKobo?`Top up ${formatNaira(estimate.fareKobo-walletKobo)} to pay with wallet`:`Available balance: ${formatNaira(walletKobo)}`:item.detail}</Text></View><View className={`h-5 w-5 items-center justify-center rounded-full border ${item.id === payment ? 'border-primary' : 'border-borderStrong'}`}>{item.id === payment ? <View className="h-3 w-3 rounded-full bg-primary" /> : null}</View>
          </Pressable>)}
        </Pressable>
      </Pressable>
    </Modal>
    <RideConfirmationModal visible={confirmationOpen} rideName={selected.name} fare={fareFor(selected.multiplier)} etaMinutes={eta + selected.etaOffset} paymentName={selectedPayment.name} pickupAddress={pickup?.address ?? 'Pickup location'} dropoffAddress={dropoff?.address ?? 'Destination'} onClose={() => setConfirmationOpen(false)} onConfirm={() => void confirmRequest()} />
  </View>;
}
