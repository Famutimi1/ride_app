import { useMemo, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppMap, type AppMapMarker } from '@/components/map';
import { Button, Text } from '@/components/common';
import { decodePolyline } from '@/utils/polyline';
import { useMapStore } from '@/store/mapStore';
import { useTripStore } from '@/store/tripStore';

export function DriverTripScreen() {
  const router = useRouter();
  const trip = useTripStore((state) => state.trip);
  const loading = useTripStore((state) => state.loading);
  const arrived = useTripStore((state) => state.arrived);
  const start = useTripStore((state) => state.start);
  const complete = useTripStore((state) => state.complete);
  const cancel = useTripStore((state) => state.cancel);
  const region = useMapStore((state) => state.cameraRegion);
  const current = useMapStore((state) => state.currentLocation);
  const [actionError, setActionError] = useState<string | null>(null);
  const route = trip?.route_polyline ? decodePolyline(trip.route_polyline) : [];
  const markers = useMemo<AppMapMarker[]>(() => trip ? [
    { id: 'pickup', kind: 'pickup', latitude: trip.pickup_lat, longitude: trip.pickup_lng, title: trip.pickup_address },
    { id: 'dropoff', kind: 'dropoff', latitude: trip.dropoff_lat, longitude: trip.dropoff_lng, title: trip.dropoff_address },
    ...(current ? [{ id: 'driver', kind: 'driver' as const, ...current, title: 'Your location' }] : []),
  ] : [], [current, trip]);

  if (!trip) return <Redirect href="/driver-dashboard" />;
  if (trip.status === 'completed') return <Redirect href="/trip-complete" />;
  if (trip.status === 'cancelled' || trip.status === 'no_drivers_found') return <Redirect href="/driver-dashboard" />;

  const copy = trip.status === 'driver_assigned'
    ? { title: 'Drive to the pickup', detail: 'Let the rider know when you arrive.', button: 'I have arrived', run: arrived }
    : trip.status === 'driver_arrived'
      ? { title: 'Waiting for the rider', detail: 'Confirm the rider is in the vehicle before starting.', button: 'Start trip', run: start }
      : { title: 'Trip in progress', detail: 'Drive safely to the destination.', button: 'Complete trip', run: complete };

  const performAction = async () => {
    setActionError(null);
    try {
      await copy.run();
      if (trip.status === 'in_progress') router.replace('/trip-complete');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update this trip.');
    }
  };
  const runAction = () => {
    if (trip.status !== 'in_progress') return void performAction();
    Alert.alert('Complete this trip?', 'Confirm only after reaching the destination. This will settle the fare.', [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Complete trip', onPress: () => void performAction() },
    ]);
  };
  const openNavigation = () => {
    const target = trip.status === 'in_progress'
      ? { latitude: trip.dropoff_lat, longitude: trip.dropoff_lng }
      : { latitude: trip.pickup_lat, longitude: trip.pickup_lng };
    void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${target.latitude},${target.longitude}&travelmode=driving`);
  };

  const confirmCancel = () => Alert.alert('Cancel this trip?', 'The rider will be notified immediately.', [
    { text: 'Keep trip', style: 'cancel' },
    { text: 'Cancel trip', style: 'destructive', onPress: () => void cancel('Driver can no longer complete the trip').then(() => router.replace('/driver-dashboard')) },
  ]);

  return <View className="flex-1 bg-background">
    <View className="h-[48%]"><AppMap region={region} markers={markers} polyline={route} showsUserLocation followsUserLocation mapPadding={{ top: 90, right: 32, bottom: 90, left: 32 }} /></View>
    <SafeAreaView edges={['top']} className="absolute left-lg right-lg top-0"><View className="flex-row items-center gap-md"><Pressable onPress={() => router.replace('/driver-dashboard')} className="h-12 w-12 items-center justify-center rounded-full bg-surface shadow-md"><Text variant="h3">←</Text></Pressable><View className="flex-1 rounded-xl bg-surface px-lg py-md shadow-md"><Text variant="bodyMedium">{copy.title}</Text><Text variant="caption" color="textMuted">{copy.detail}</Text></View></View></SafeAreaView>
    <View className="absolute bottom-0 left-0 right-0 h-[57%] rounded-t-[28px] bg-surface shadow-lg"><View className="items-center py-md"><View className="h-1 w-12 rounded-full bg-borderStrong" /></View><ScrollView contentContainerClassName="px-xl pb-xl" showsVerticalScrollIndicator={false}>
      <Text variant="caption" color="secondary" className="uppercase tracking-widest">{trip.status.replaceAll('_', ' ')}</Text><Text variant="h2" className="mt-xs !text-[28px]">{copy.title}</Text>
      <View className="mt-lg flex-row items-center rounded-xl bg-surfaceMuted p-md"><View className="h-14 w-14 items-center justify-center rounded-full bg-successSoft"><Text variant="h3" color="success">{(trip.rider_name ?? 'R').charAt(0)}</Text></View><View className="ml-md flex-1"><Text variant="h3" className="!text-[20px]">{trip.rider_name ?? 'Rider'}</Text><Text variant="caption" color="textMuted">Verified Rakky Ride rider</Text></View><Pressable onPress={() => router.push({ pathname: '/trip-chat', params: { tripId: trip.id, participantName: trip.rider_name ?? 'Rider' } })} className="rounded-full bg-primarySoft px-md py-sm"><Text variant="button" color="primary">Message</Text></Pressable></View>
      <View className="mt-md rounded-xl bg-surfaceMuted p-md"><RouteRow label="Pickup" value={trip.pickup_address} /><View className="my-xs ml-[5px] h-4 w-px bg-borderStrong" /><RouteRow label="Destination" value={trip.dropoff_address} /></View>
      <View className="mt-md flex-row items-center rounded-xl border border-border p-md"><View className="flex-1"><Text variant="caption" color="textMuted">{trip.payment_method === 'cash' ? 'Collect cash after trip' : 'Paid through wallet'}</Text><Text variant="bodyMedium">Trip fare</Text></View><Text variant="h3">₦{Math.round(trip.fare_kobo / 100).toLocaleString()}</Text></View>
      {actionError ? <Text variant="caption" color="danger" className="mt-md">{actionError}</Text> : null}
      <Button label="Open in Google Maps" variant="outline" fullWidth className="mt-lg" onPress={openNavigation} />
      <Button label={copy.button} fullWidth loading={loading} className="mt-sm" onPress={runAction} />
      {trip.status !== 'in_progress' ? <Button label="Cancel trip" variant="ghost" fullWidth className="mt-sm" onPress={confirmCancel} /> : null}
    </ScrollView></View>
  </View>;
}

function RouteRow({ label, value }: { label: string; value: string }) { return <View className="flex-row gap-md"><Text color={label === 'Pickup' ? 'primary' : 'danger'}>●</Text><View className="flex-1"><Text variant="caption" color="textMuted">{label}</Text><Text variant="bodyMedium" numberOfLines={2}>{value}</Text></View></View>; }
