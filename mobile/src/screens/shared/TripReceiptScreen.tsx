import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/common';
import { getTrip, type Trip } from '@/services/tripService';

export function TripReceiptScreen() {
  const router = useRouter();
  const { tripId } = useLocalSearchParams<{ tripId?: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!tripId) return;
    void getTrip(tripId).then(setTrip).catch(() => setError('This receipt could not be loaded.')).finally(() => setLoading(false));
  }, [tripId]);
  if (!tripId) return <Redirect href="/menu" />;
  return <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}><View className="flex-row items-center border-b border-border px-xl py-md"><Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/menu')} className="h-11 w-11 items-center justify-center rounded-full bg-surfaceMuted"><Text variant="h3">←</Text></Pressable><View className="ml-md"><Text variant="h3">Trip receipt</Text><Text variant="caption" color="textMuted">{trip ? new Date(trip.completed_at ?? trip.requested_at).toLocaleString() : 'Rakky Ride'}</Text></View></View><ScrollView contentContainerClassName="px-xl py-xl">
    {loading ? <Text color="textMuted">Loading receipt…</Text> : error || !trip ? <View className="rounded-xl bg-dangerSoft p-lg"><Text color="danger">{error ?? 'Trip not found.'}</Text></View> : <><View className="items-center rounded-2xl bg-successSoft p-xl"><Text variant="caption" color="success" className="uppercase">{trip.status.replaceAll('_', ' ')}</Text><Text variant="h1" className="mt-xs">₦{Math.round(trip.fare_kobo / 100).toLocaleString()}</Text><Text variant="caption" color="textMuted">{trip.payment_method === 'cash' ? 'Cash' : 'Rakky Ride wallet'}</Text></View><View className="mt-lg rounded-xl bg-surface p-lg"><ReceiptRow label="Pickup" value={trip.pickup_address} /><ReceiptRow label="Destination" value={trip.dropoff_address} /><ReceiptRow label="Distance" value={`${(trip.estimated_distance_m / 1000).toFixed(1)} km`} /><ReceiptRow label="Estimated duration" value={`${Math.ceil(trip.estimated_duration_s / 60)} min`} /><ReceiptRow label="Vehicle" value={[trip.vehicle_color, trip.vehicle_make, trip.vehicle_model].filter(Boolean).join(' ') || 'Economy ride'} /><ReceiptRow label="Driver" value={trip.driver_name ?? 'Not assigned'} /><ReceiptRow label="Trip ID" value={trip.id} last /></View>{trip.status === 'cancelled' ? <View className="mt-md rounded-xl bg-dangerSoft p-md"><Text color="danger">This trip was cancelled.</Text></View> : null}</>}
  </ScrollView></SafeAreaView>;
}

function ReceiptRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) { return <View className={`py-md ${last ? '' : 'border-b border-border'}`}><Text variant="caption" color="textMuted">{label}</Text><Text variant="bodyMedium" className="mt-xs">{value}</Text></View>; }
