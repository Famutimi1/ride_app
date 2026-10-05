import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Input, RatingStars, Text } from '@/components/common';
import { useAuthStore } from '@/store/authStore';
import { useMapStore } from '@/store/mapStore';
import { useTripStore } from '@/store/tripStore';

export function TripCompletedScreen() {
  const router = useRouter();
  const role = useAuthStore((state) => state.session?.user.role ?? 'rider');
  const trip = useTripStore((state) => state.trip);
  const rate = useTripStore((state) => state.rate);
  const clear = useTripStore((state) => state.clear);
  const loading = useTripStore((state) => state.loading);
  const clearTripMap = useMapStore((state) => state.clearTripMap);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!trip) return <Redirect href={role === 'driver' ? '/driver-dashboard' : '/home'} />;

  const isDriver = role === 'driver';
  const finish = async () => {
    setError(null);
    try { await rate(rating, comment.trim() || undefined); clear(); clearTripMap(); router.replace(isDriver ? '/driver-dashboard' : '/home'); }
    catch (value) { setError(value instanceof Error ? value.message : 'Could not save your rating.'); }
  };

  return <SafeAreaView className="flex-1 bg-background px-xl"><View className="flex-1 justify-center">
    <View className="items-center"><View className="h-20 w-20 items-center justify-center rounded-full bg-successSoft"><Text variant="h2" color="success">✓</Text></View><Text variant="h2" className="mt-lg">Trip completed</Text><Text color="textMuted" className="mt-xs text-center">{trip.pickup_address} to {trip.dropoff_address}</Text></View>
    <View className="mt-xl rounded-xl bg-surface p-xl shadow-sm"><View className="flex-row justify-between"><Text color="textMuted">Total fare</Text><Text variant="h3">₦{Math.round(trip.fare_kobo / 100).toLocaleString()}</Text></View>{isDriver ? <><View className="my-md h-px bg-border" /><View className="flex-row justify-between"><Text color="textMuted">Rakky Ride commission</Text><Text color="danger">−₦{Math.round((trip.commission_kobo ?? 0) / 100).toLocaleString()}</Text></View><View className="mt-sm flex-row justify-between"><Text variant="bodyMedium">Your earnings</Text><Text variant="h3" color="success">₦{Math.round((trip.driver_earning_kobo ?? trip.fare_kobo) / 100).toLocaleString()}</Text></View></> : null}<Text variant="caption" color="textMuted" className="mt-md">{trip.payment_method === 'cash' ? (isDriver ? 'Collect this fare directly from the rider.' : 'Pay the driver in cash.') : 'Payment settled from Rakky Ride wallet.'}</Text></View>
    <View className="mt-xl items-center"><Text variant="h3">Rate your {isDriver ? 'rider' : 'driver'}</Text><View className="mt-md"><RatingStars value={rating} size={36} interactive onChange={setRating} /></View></View>
    <Input value={comment} onChangeText={setComment} placeholder="Add a comment (optional)" maxLength={500} containerClassName="mt-lg" />
    {error ? <Text variant="caption" color="danger" className="mt-sm">{error}</Text> : null}
    <Button label="Submit rating" fullWidth loading={loading} className="mt-lg" onPress={() => void finish()} />
    <Button label="Skip" variant="ghost" fullWidth onPress={() => { clear(); clearTripMap(); router.replace(isDriver ? '/driver-dashboard' : '/home'); }} />
  </View></SafeAreaView>;
}
