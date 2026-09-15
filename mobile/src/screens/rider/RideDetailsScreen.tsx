import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text } from '@/components/common';
import { AppMap, DriverResponseModal, RideConfirmationModal, type AppMapMarker } from '@/components/map';
import { nativeWindTheme, useTheme } from '@/constants/theme';
import { getTripEstimate, type TripEstimate } from '@/services/mapsService';
import { useMapStore } from '@/store/mapStore';

type RideId = 'economy' | 'comfort' | 'xl';
type PaymentId = 'cash' | 'card' | 'wallet';

const RIDE_DETAILS = {
  economy: { name: 'Ride', description: 'Dependable everyday rides in comfortable, mid-size cars.', seats: 4, multiplier: 1, badges: ['Recommended', 'Best value'] },
  comfort: { name: 'Comfort', description: 'Newer vehicles and highly rated drivers for a quieter trip.', seats: 4, multiplier: 1.35, badges: ['Top drivers', 'Extra comfort'] },
  xl: { name: 'XL', description: 'More room for groups, luggage, and comfortable airport trips.', seats: 6, multiplier: 1.7, badges: ['Spacious', 'Group ride'] },
} as const;

const PAYMENT_OPTIONS = [
  { id: 'cash' as const, name: 'Cash', detail: 'Pay your driver after the ride', icon: '▣' },
  { id: 'card' as const, name: 'Card', detail: 'Secure payment with Paystack', icon: '▤' },
  { id: 'wallet' as const, name: 'Ride wallet', detail: 'Balance: ₦0', icon: '◉' },
];

export function RideDetailsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ ride?: string }>();
  const rideId: RideId = params.ride === 'comfort' || params.ride === 'xl' ? params.ride : 'economy';
  const ride = RIDE_DETAILS[rideId];
  const pickup = useMapStore((state) => state.pickupLocation);
  const dropoff = useMapStore((state) => state.dropoffLocation);
  const route = useMapStore((state) => state.routeCoordinates);
  const region = useMapStore((state) => state.cameraRegion);
  const [estimate, setEstimate] = useState<TripEstimate | null>(null);
  const [offerFare, setOfferFare] = useState('');
  const [autoAccept, setAutoAccept] = useState(true);
  const [payment, setPayment] = useState<PaymentId>('cash');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [waitingForDriver, setWaitingForDriver] = useState(false);

  useEffect(() => {
    if (!pickup || !dropoff) return;
    void getTripEstimate(pickup, dropoff).then((value) => {
      setEstimate(value);
      setOfferFare(String(Math.ceil(value.estimatedFare * ride.multiplier * 0.9 / 50) * 50));
    }).catch(() => undefined);
  }, [dropoff, pickup, ride.multiplier]);

  useEffect(() => {
    if (!waitingForDriver) return;
    const acceptedTimer = setTimeout(() => router.replace('/ongoing-trip'), 5000);
    return () => clearTimeout(acceptedTimer);
  }, [router, waitingForDriver]);

  const markers = useMemo<AppMapMarker[]>(() => [
    ...(pickup ? [{ ...pickup, id: 'pickup', kind: 'pickup' as const }] : []),
    ...(dropoff ? [{ ...dropoff, id: 'dropoff', kind: 'dropoff' as const }] : []),
  ], [dropoff, pickup]);
  const fallbackFare = { economy: 2900, comfort: 3900, xl: 4900 }[rideId];
  const recommendedFare = estimate ? Math.ceil(estimate.estimatedFare * ride.multiplier * 0.9 / 50) * 50 : fallbackFare;
  const fare = Number(offerFare) || recommendedFare;
  const waitRate = Math.max(45, Math.round(fare * 0.007));
  const levy = 30;
  const bookingFee = Math.round(fare * 0.05);
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
        <View className="mt-md flex-row items-center gap-sm"><Text variant="h3" className="!text-[24px]">{ride.name}</Text>{ride.badges.map((badge) => <View key={badge} className="rounded-sm bg-success px-sm py-xs"><Text variant="caption" color="textInverse" className="!text-[10px]">{badge}</Text></View>)}</View>
        <Text color="textMuted" className="mt-xs">{ride.description}</Text>

        <View className="mt-md rounded-xl bg-successSoft p-md"><View className="flex-row items-center gap-md"><View className="h-10 w-10 items-center justify-center rounded-lg bg-success"><Text color="textInverse">＋</Text></View><View className="flex-1"><Text variant="bodyMedium" color="success">Earn 5% cashback with Ride Plus</Text><Text variant="caption" color="textMuted">Try it free on your first month</Text></View></View></View>
        <View className="mt-sm flex-row gap-md rounded-xl bg-warningSoft p-md"><Text color="warning">⌁</Text><View className="flex-1"><Text variant="bodyMedium">High demand nearby</Text><Text variant="caption" color="textMuted">Prices may be temporarily higher while more drivers become available.</Text></View></View>

        <View className="mt-lg"><Text variant="caption" color="textMuted">Offer your fare</Text><View className="mt-xs flex-row items-end border-b border-borderStrong pb-sm"><Text variant="h2" className="!text-[27px]">₦</Text><TextInput value={offerFare || String(recommendedFare)} onChangeText={(value) => setOfferFare(value.replace(/\D/g, ''))} keyboardType="number-pad" selectionColor={theme.colors.primary} className="flex-1 p-0 font-inter-bold text-[30px] text-text outline-none" /></View><Text variant="caption" color="textMuted" className="mt-xs">Recommended fare: ₦{recommendedFare.toLocaleString()}</Text></View>

        <View className="mt-lg rounded-xl border border-border p-md">
          <DetailRow label="Fare" value={`₦${fare.toLocaleString()}`} strong />
          <DetailRow label="Estimated distance" value={estimate ? `${estimate.distanceKm.toFixed(1)} km` : 'Calculating…'} />
          <DetailRow label="Estimated trip time" value={estimate ? `${Math.ceil(estimate.durationMin)} min` : 'Calculating…'} />
          <DetailRow label="Wait time" value={`₦${waitRate}/min`} />
          <DetailRow label="Lagos road development levy" value={`₦${levy}`} />
          <DetailRow label="Booking fee" value={`₦${bookingFee}`} />
          <DetailRow label="Seats" value={String(ride.seats)} last />
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel="Choose payment method" onPress={() => setPaymentOpen(true)} className="mt-md flex-row items-center rounded-xl border border-border p-md"><View className="h-10 w-10 items-center justify-center rounded-lg bg-successSoft"><Text color="success">{selectedPayment.icon}</Text></View><View className="ml-md flex-1"><Text variant="bodyMedium">{selectedPayment.name}</Text><Text variant="caption" color="textMuted">{selectedPayment.detail}</Text></View><Text color="icon">›</Text></Pressable>
        <View className="mt-sm flex-row items-center rounded-xl border border-border p-md"><View className="flex-1"><Text variant="bodyMedium">Automatically accept nearest driver</Text><Text variant="caption" color="textMuted">Accept the first driver available for ₦{fare.toLocaleString()}</Text></View><Switch value={autoAccept} onValueChange={setAutoAccept} trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primary }} thumbColor={theme.colors.surface} /></View>

        <View className="mt-md rounded-xl bg-surfaceMuted p-md"><LocationRow icon="●" label="Pickup" value={pickup?.address ?? 'Pickup location'} /><View className="ml-[5px] h-5 w-px bg-borderStrong" /><LocationRow icon="■" label="Drop-off" value={dropoff?.address ?? 'Destination'} /></View>
        <Text variant="caption" color="textMuted" className="mt-md">The estimate may change if tolls, waiting time, or the route differs from the original trip.</Text>
      </ScrollView>
      <SafeAreaView edges={['bottom']} className="border-t border-border bg-surface px-xl pt-md"><Button label={autoAccept ? `Find nearest driver · ₦${fare.toLocaleString()}` : `Find offers · ₦${fare.toLocaleString()}`} size="lg" fullWidth onPress={() => setConfirmationOpen(true)} /></SafeAreaView>
    </View>

    <Modal visible={paymentOpen} transparent animationType="slide" onRequestClose={() => setPaymentOpen(false)}><Pressable onPress={() => setPaymentOpen(false)} className="flex-1 justify-end" style={[nativeWindTheme[theme.scheme], { backgroundColor: theme.colors.overlay }]}><Pressable onPress={(event) => event.stopPropagation()} className="rounded-t-[28px] p-xl" style={{ backgroundColor: theme.colors.surface }}><View className="mb-md items-center"><View className="h-1 w-12 rounded-full bg-borderStrong" /></View><Text variant="h3" className="!text-[22px]">Choose payment</Text>{PAYMENT_OPTIONS.map((item) => <Pressable key={item.id} onPress={() => { setPayment(item.id); setPaymentOpen(false); }} className="flex-row items-center gap-md border-b border-border py-md"><View className="h-11 w-11 items-center justify-center rounded-lg bg-surfaceMuted"><Text color={item.id === payment ? 'primary' : 'icon'}>{item.icon}</Text></View><View className="flex-1"><Text variant="bodyMedium">{item.name}</Text><Text variant="caption" color="textMuted">{item.detail}</Text></View>{item.id === payment ? <Text color="primary">●</Text> : <Text color="icon">○</Text>}</Pressable>)}</Pressable></Pressable></Modal>
    <RideConfirmationModal visible={confirmationOpen} rideName={ride.name} fare={fare} etaMinutes={Math.max(3, Math.ceil((estimate?.durationMin ?? 8) * 0.35))} paymentName={selectedPayment.name} pickupAddress={pickup?.address ?? 'Pickup location'} dropoffAddress={dropoff?.address ?? 'Destination'} onClose={() => setConfirmationOpen(false)} onConfirm={() => { setConfirmationOpen(false); setWaitingForDriver(true); }} />
    <DriverResponseModal visible={waitingForDriver} rideName={ride.name} fare={fare} onCancel={() => setWaitingForDriver(false)} />
  </View>;
}

function DetailRow({ label, value, strong = false, last = false }: { label: string; value: string; strong?: boolean; last?: boolean }) {
  return <View className={`flex-row items-center justify-between py-sm ${last ? '' : 'border-b border-border'}`}><Text variant={strong ? 'bodyMedium' : 'caption'} color={strong ? 'text' : 'textMuted'}>{label}</Text><Text variant={strong ? 'bodyMedium' : 'caption'}>{value}</Text></View>;
}

function LocationRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return <View className="flex-row items-center gap-md"><Text color={label === 'Pickup' ? 'primary' : 'danger'}>{icon}</Text><View className="flex-1"><Text variant="caption" color="textMuted">{label}</Text><Text variant="bodyMedium" numberOfLines={2}>{value}</Text></View></View>;
}
