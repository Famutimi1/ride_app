import { userErrorMessage } from '@/utils/userMessage';
import { AppMessage } from '@/components/common/AppMessage';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Input, RatingStars, Text } from '@/components/common';
import { useAuthStore } from '@/store/authStore';
import { useMapStore } from '@/store/mapStore';
import { useTripStore } from '@/store/tripStore';
import { roleHome, tripBelongsToRole } from '@/utils/roleAccess';
import { DriverTripCompletedView } from '@/screens/driver/DriverTripCompletedView';

export function TripCompletedScreen() {
  const router = useRouter();
  const role = useAuthStore((state) => state.session?.user.role ?? 'rider');
  const userId = useAuthStore((state) => state.session?.user.id);
  const trip = useTripStore((state) => state.trip);
  const rate = useTripStore((state) => state.rate);
  const clear = useTripStore((state) => state.clear);
  const loading = useTripStore((state) => state.loading);
  const clearTripMap = useMapStore((state) => state.clearTripMap);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  if (!trip || !tripBelongsToRole(trip, userId, role) || !['completed', 'returned'].includes(trip.status)) return <Redirect href={roleHome(role)} />;

  const isDriver = role === 'driver';
  const returned = trip.status === 'returned';
  const courier = trip.service_type === 'courier';
  const finish = async () => {
    if (loading || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try { await rate(rating, comment.trim() || undefined); clear(); clearTripMap(); router.replace(isDriver ? '/driver-dashboard' : '/home'); }
    catch (value) { setError(userErrorMessage(value, 'Could not save your rating.')); }
    finally { submittingRef.current = false; setSubmitting(false); }
  };

  if (isDriver) return <DriverTripCompletedView trip={trip} rating={rating} comment={comment} error={error} busy={loading || submitting}
    onRatingChange={setRating} onCommentChange={setComment} onSubmit={() => void finish()}
    onDone={() => { if (loading || submittingRef.current) return; clear(); clearTripMap(); router.replace('/driver-dashboard'); }} />;

  return <SafeAreaView className="flex-1 bg-background px-xl"><View className="flex-1 justify-center">
    <View className="items-center"><View className="h-20 w-20 items-center justify-center rounded-full bg-successSoft"><Text variant="h2" color="success">✓</Text></View><Text variant="h2" className="mt-lg">{returned ? 'Package returned' : courier ? 'Package delivered' : 'Trip completed'}</Text><Text color="textMuted" className="mt-xs text-center">{returned ? `Returned to ${trip.pickup_address}` : `${trip.pickup_address} to ${trip.dropoff_address}`}</Text></View>
    <View className="mt-xl rounded-xl bg-surface p-xl shadow-sm"><View className="flex-row justify-between"><Text color="textMuted">Total fare</Text><Text variant="h3">₦{Math.round(trip.fare_kobo / 100).toLocaleString()}</Text></View>{isDriver ? <><View className="my-md h-px bg-border" /><View className="flex-row justify-between"><Text color="textMuted">Rakky Ride commission</Text><Text color="danger">−₦{Math.round((trip.commission_kobo ?? 0) / 100).toLocaleString()}</Text></View><View className="mt-sm flex-row justify-between"><Text variant="bodyMedium">Your earnings</Text><Text variant="h3" color="success">₦{Math.round((trip.driver_earning_kobo ?? trip.fare_kobo) / 100).toLocaleString()}</Text></View></> : null}<Text variant="caption" color="textMuted" className="mt-md">{trip.payment_method === 'cash' ? (isDriver ? 'Collect this fare directly from the rider.' : 'Pay the driver in cash.') : 'Payment settled from Rakky Ride wallet.'}</Text></View>
    {returned ? <Text color="textMuted" className="mt-xl text-center">The recipient could not receive the package. The original delivery fare was charged; no extra return fee was added.</Text> : <><View className="mt-xl items-center"><Text variant="h3">Rate your {isDriver ? 'rider' : 'driver'}</Text><View className="mt-md"><RatingStars value={rating} size={36} interactive onChange={setRating} /></View></View><Input value={comment} onChangeText={setComment} placeholder="Add a comment (optional)" maxLength={500} containerClassName="mt-lg" /></>}
    {error ? <AppMessage message={error} className="mt-sm" /> : null}
    {!returned ? <Button label="Submit rating" fullWidth loading={loading} className="mt-lg" onPress={() => void finish()} /> : null}
    <Button label="Skip" variant="ghost" fullWidth onPress={() => { clear(); clearTripMap(); router.replace(isDriver ? '/driver-dashboard' : '/home'); }} />
  </View></SafeAreaView>;
}
