import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text } from '@/components/common';
import { apiErrorMessage } from '@/lib/apiClient';
import { cancelTrip, getScheduledTrips, type Trip } from '@/services/tripService';
import { formatScheduledTime, scheduleDays, scheduleSlots, SCHEDULE_MAX_LEAD_MS, SCHEDULE_MIN_LEAD_MS } from '@/utils/scheduleTime';

const dateLabel = (time: number) => formatScheduledTime(time, { weekday: 'short', day: 'numeric', month: 'short' });
const timeLabel = (time: number) => formatScheduledTime(time, { hour: 'numeric', minute: '2-digit', hour12: true });

function tripStatusLabel(trip: Trip): string {
  if (trip.status === 'scheduled') return 'Scheduled · Driver search has not started';
  if (trip.status === 'searching') return 'Looking for a driver';
  if (trip.status === 'no_drivers_found') return 'No driver found';
  if (trip.status === 'cancelled') {
    if (trip.cancel_reason === 'wallet_balance_insufficient') return 'Cancelled · Wallet balance was too low';
    if (trip.cancel_reason === 'wallet_unavailable') return 'Cancelled · Wallet unavailable';
    if (trip.cancel_reason === 'another_trip_active') return 'Cancelled · Another trip was active';
    if (trip.cancel_reason === 'pickup_time_passed') return 'Cancelled · Pickup time passed while service was unavailable';
    return 'Cancelled';
  }
  return 'Driver assigned';
}

export function ScheduleRideScreen() {
  const router = useRouter();
  const [today] = useState(() => Date.now());
  const days = useMemo(() => scheduleDays(today), [today]);
  const [day, setDay] = useState(days[0]);
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [upcoming, setUpcoming] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const slots = scheduleSlots(day);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setUpcoming(await getScheduledTrips()); setError(null); }
    catch (reason) { setError(apiErrorMessage(reason)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let mounted = true;
    void getScheduledTrips()
      .then((trips) => { if (mounted) setUpcoming(trips); })
      .catch((reason: unknown) => { if (mounted) setError(apiErrorMessage(reason)); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => { const timer = setInterval(() => { void refresh(); }, 30_000); return () => clearInterval(timer); }, [refresh]);

  const continueBooking = () => {
    if (!selectedTime || selectedTime < Date.now() + SCHEDULE_MIN_LEAD_MS || selectedTime > Date.now() + SCHEDULE_MAX_LEAD_MS) {
      setError('Choose a pickup time at least 30 minutes from now and within the next 7 days.');
      return;
    }
    router.push({ pathname: '/set-destination', params: { scheduledAt: new Date(selectedTime).toISOString() } });
  };

  const confirmCancel = async () => {
    if (!cancelId) return;
    setCancelling(true);
    try { await cancelTrip(cancelId, 'Cancelled scheduled ride'); setCancelId(null); await refresh(); }
    catch (reason) { setError(apiErrorMessage(reason)); }
    finally { setCancelling(false); }
  };

  return <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
    <View className="flex-row items-center border-b border-border px-xl py-md">
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/home')} className="h-11 w-11 items-center justify-center rounded-full bg-surfaceMuted"><Text variant="h3">←</Text></Pressable>
      <View className="ml-md"><Text variant="h3">Schedule a ride</Text><Text variant="caption" color="textMuted">Plan your pickup in Lagos time</Text></View>
    </View>
    <ScrollView className="flex-1" contentContainerClassName="pb-xl" showsVerticalScrollIndicator={false}>
      <View className="mx-xl mt-lg rounded-2xl bg-primarySoft p-lg">
        <Text variant="h3" color="primary">Be ready when it matters</Text>
        <Text color="textMuted" className="mt-sm">Choose a pickup time, then add your route. We start looking for a nearby driver about 5 minutes before pickup. A driver is not guaranteed until one accepts.</Text>
      </View>

      <View className="mt-xl px-xl"><Text variant="h3">Pickup day</Text><Text variant="caption" color="textMuted" className="mt-xs">Book from 30 minutes to 7 days ahead</Text></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-sm px-xl py-md">
        {days.map((value, index) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: day === value }} onPress={() => { setDay(value); setSelectedTime(null); setError(null); }} className={`min-w-24 rounded-xl border p-md ${day === value ? 'border-primary bg-primarySoft' : 'border-border bg-surface'}`}>
          <Text variant="caption" color={day === value ? 'primary' : 'textMuted'}>{index === 0 ? 'Today' : index === 1 ? 'Tomorrow' : formatScheduledTime(value, { weekday: 'short' })}</Text>
          <Text variant="bodyMedium" className="mt-xs">{formatScheduledTime(value, { day: 'numeric', month: 'short' })}</Text>
        </Pressable>)}
      </ScrollView>

      <View className="px-xl"><Text variant="h3">Pickup time</Text><Text variant="caption" color="textMuted" className="mt-xs">West Africa Time (WAT, UTC+1)</Text>
        {slots.length ? <View className="mt-md flex-row flex-wrap gap-sm">{slots.map((value) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Pickup at ${timeLabel(value)}`} accessibilityState={{ selected: selectedTime === value }} onPress={() => { setSelectedTime(value); setError(null); }} className={`w-[31%] items-center rounded-lg border py-sm ${selectedTime === value ? 'border-primary bg-primarySoft' : 'border-border bg-surface'}`}><Text variant="bodyMedium" color={selectedTime === value ? 'primary' : 'text'}>{timeLabel(value)}</Text></Pressable>)}</View>
          : <Text color="textMuted" className="mt-md">No times remain for this day. Choose another day.</Text>}
      </View>

      {upcoming.length ? <View className="mt-xl border-t border-border px-xl pt-lg"><View className="flex-row items-center justify-between"><Text variant="h3">Scheduled rides</Text><Pressable onPress={() => void refresh()}><Text variant="caption" color="primary">Refresh</Text></Pressable></View>
        {upcoming.map((trip) => <View key={trip.id} className="mt-md rounded-xl border border-border bg-surface p-md">
          <Text variant="bodyMedium" color="primary">{trip.scheduled_at ? `${dateLabel(new Date(trip.scheduled_at).getTime())} · ${timeLabel(new Date(trip.scheduled_at).getTime())}` : 'Scheduled ride'}</Text>
          <Text variant="caption" color={trip.status === 'cancelled' || trip.status === 'no_drivers_found' ? 'danger' : 'success'} className="mt-xs">{tripStatusLabel(trip)}</Text>
          <Text variant="caption" color="textMuted" className="mt-xs" numberOfLines={2}>From {trip.pickup_address}</Text>
          <Text variant="caption" color="textMuted" className="mt-xs" numberOfLines={2}>To {trip.dropoff_address}</Text>
          <Text variant="caption" color="textMuted" className="mt-xs">₦{(trip.fare_kobo / 100).toLocaleString()} · {trip.payment_method === 'wallet' ? 'Wallet' : 'Cash'}</Text>
          {trip.status === 'scheduled' ? cancelId === trip.id ? <View className="mt-md rounded-lg bg-dangerSoft p-sm"><Text variant="caption">Cancel this scheduled ride?</Text><View className="mt-sm flex-row gap-lg"><Pressable onPress={() => setCancelId(null)}><Text variant="caption" color="textMuted">Keep ride</Text></Pressable><Pressable disabled={cancelling} onPress={() => void confirmCancel()}><Text variant="caption" color="danger">{cancelling ? 'Cancelling…' : 'Yes, cancel'}</Text></Pressable></View></View>
            : <Pressable onPress={() => setCancelId(trip.id)} className="mt-md self-start py-xs"><Text variant="caption" color="danger">Cancel ride</Text></Pressable> : null}
          {trip.status === 'searching' || trip.status === 'driver_assigned' || trip.status === 'driver_arrived' || trip.status === 'in_progress' ? <Pressable onPress={() => router.push('/ongoing-trip')} className="mt-md self-start py-xs"><Text variant="caption" color="primary">View live ride →</Text></Pressable> : null}
        </View>)}
      </View> : <View className="mx-xl mt-xl rounded-xl bg-surfaceMuted p-md"><Text variant="bodyMedium">{loading ? 'Loading upcoming rides…' : 'No upcoming rides yet'}</Text><Text variant="caption" color="textMuted" className="mt-xs">Your scheduled trips will appear here after you book.</Text></View>}
      {error ? <Text variant="caption" color="danger" className="mx-xl mt-md">{error}</Text> : null}
    </ScrollView>
    <View className="border-t border-border bg-surface px-xl py-md"><Button label={selectedTime ? `Continue · ${dateLabel(selectedTime)}, ${timeLabel(selectedTime)}` : 'Choose a pickup time'} fullWidth disabled={!selectedTime} onPress={continueBooking} /></View>
  </SafeAreaView>;
}
