/** Rider home: live map, destination search, and an adjustable address sheet. */
import { useCallback, useState } from 'react';
import { cssInterop } from 'nativewind';
import { useFocusEffect, useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, ThemeToggle } from '@/components/common';
import { DriverOnlineControl, RideMap } from '@/components/map';
import { useAuthStore } from '@/store/authStore';
import { useMapStore } from '@/store/mapStore';
import { focusOnCurrentLocation, LocationUnavailableError } from '@/services/locationService';
import { getTripRoute } from '@/services/mapsService';
import { getTripHistory } from '@/services/tripService';
import { selectRepeatRides, type RepeatRide } from '@/utils/rideAgain';

const StyledSafeAreaView = cssInterop(SafeAreaView, { className: 'style' });

const SERVICES = [
  { id: 'ride', icon: '🚙', label: 'Ride', detail: 'Everyday trips', service: 'ride' },
  { id: 'courier', icon: '📦', label: 'Courier', detail: 'Send a package', service: 'courier' },
  { id: 'schedule', icon: '◷', label: 'Schedule', detail: 'Book ahead', service: 'scheduled' },
] as const;

export function HomeScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.session?.user);
  const userId = user?.id;
  const userRole = user?.role;
  const driverApplication = useAuthStore((state) => state.driverApplication);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [repeatRides, setRepeatRides] = useState<RepeatRide[]>([]);
  const [ridesLoading, setRidesLoading] = useState(true);
  const [ridesError, setRidesError] = useState(false);
  const [refreshRides, setRefreshRides] = useState(0);

  useFocusEffect(useCallback(() => {
    if (!userId || userRole !== 'rider') return;
    let active = true;
    setRidesLoading(true);
    setRidesError(false);
    if (refreshRides > 0) setRepeatRides([]);
    const load = async () => {
      try {
        const trips = [] as Awaited<ReturnType<typeof getTripHistory>>['trips'];
        let cursor: string | undefined;
        for (let page = 0; page < 5; page += 1) {
          const result = await getTripHistory(cursor, { serviceType: 'ride', limit: 50 });
          trips.push(...result.trips);
          if (selectRepeatRides(trips).length >= 2 || !result.nextCursor) break;
          cursor = result.nextCursor;
        }
        if (active) setRepeatRides(selectRepeatRides(trips));
      } catch {
        if (active) setRidesError(true);
      } finally {
        if (active) setRidesLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [userId, userRole, refreshRides]));

  if (!user) return null;

  const openDestinationPage = () => router.push('/set-destination');
  const repeatRide = (ride: RepeatRide) => {
    const trip = ride.trip;
    const pickup = { latitude: trip.pickup_lat, longitude: trip.pickup_lng, address: trip.pickup_address, placeId: trip.pickup_place_id ?? undefined };
    const dropoff = { latitude: trip.dropoff_lat, longitude: trip.dropoff_lng, address: trip.dropoff_address, placeId: trip.dropoff_place_id ?? undefined };
    const map = useMapStore.getState();
    map.setPickupLocation(pickup);
    map.setDropoffLocation(dropoff);
    map.setRouteCoordinates([]);
    map.setCameraRegion({ ...pickup, latitudeDelta: 0.018, longitudeDelta: 0.014 });
    router.push('/set-destination');
    void getTripRoute(pickup, dropoff).then((route) => {
      useMapStore.getState().setRouteForEndpoints(pickup, dropoff, route.coordinates);
    }).catch(() => { /* The selected addresses remain editable if directions are unavailable. */ });
  };

  return (
    <View className="flex-1 bg-background">
      <RideMap />
      {user.role === 'driver' && driverApplication?.status === 'approved' ? <DriverOnlineControl driverId={user.id} /> : null}

      <StyledSafeAreaView edges={['top']} className="absolute left-sm right-sm top-0 pt-sm">
        <View className="flex-row items-center justify-between">
          <Pressable accessibilityRole="button" accessibilityLabel="Open account menu" onPress={() => router.push('/menu')} className="h-12 w-12 items-center justify-center rounded-full bg-surface shadow-sm active:opacity-70">
            <Text variant="h3" className="!text-[22px]">☰</Text>
          </Pressable>
          <ThemeToggle floating />
        </View>

        <View className="mt-md h-14 flex-row items-center rounded-lg bg-surface p-xs pl-md shadow-md">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open pickup and destination search"
            onPress={openDestinationPage}
            className="h-full flex-1 flex-row items-center gap-md active:opacity-60"
          >
            <Text variant="h3" color="icon" className="!text-[22px]">⌕</Text>
            <Text variant="bodyMedium" color="textMuted" numberOfLines={1}>
              Where to?
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Schedule a ride for later"
            onPress={() => router.push('/schedule')}
            className="h-11 flex-row items-center gap-sm rounded-md bg-surfaceMuted px-md active:opacity-70"
          >
            <Text variant="body" color="icon">▣</Text>
            <Text variant="caption">Schedule</Text>
          </Pressable>
        </View>
        {locationError ? <View accessibilityRole="alert" className="mt-sm rounded-lg bg-surface p-md shadow-sm">
          <Text variant="caption">{locationError}</Text>
        </View> : null}
      </StyledSafeAreaView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Center map on my current location"
        onPress={() => {
          setLocationError(null);
          void focusOnCurrentLocation().then((permission) => {
            if (permission !== 'granted') setLocationError('Allow location access to center the map on your position.');
          }).catch((error: unknown) => {
            setLocationError(error instanceof LocationUnavailableError
              ? error.message
              : 'Could not refresh your location. Please try again.');
          });
        }}
        className="absolute right-lg top-[42%] h-12 w-12 items-center justify-center rounded-full bg-success shadow-md active:opacity-80"
      >
        <Text variant="h3" color="textInverse" className="!text-[22px]">◎</Text>
      </Pressable>

      <StyledSafeAreaView
        edges={['bottom']}
        className="absolute bottom-0 left-0 right-0 h-[48%] rounded-t-[28px] bg-surface pb-sm pt-md shadow-lg"
      >
          <ScrollView className="flex-1" contentContainerClassName="pb-md" showsVerticalScrollIndicator={false}>
          <View>
            <View className="mb-sm items-center">
              <View className="h-1 w-10 rounded-full bg-borderStrong" />
            </View>
            <View className="flex-row items-center justify-between px-xl">
              <Text variant="bodyMedium">Our services</Text>
              <Pressable onPress={() => router.push({ pathname: '/account/[section]', params: { section: 'services' } })} className="px-xs py-xs active:opacity-60">
                <Text variant="caption" color="primary">Explore</Text>
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-sm px-xl py-md">
              {SERVICES.map((service) => <Pressable key={service.id} onPress={() => service.id === 'schedule' ? router.push('/schedule') : service.id === 'courier' ? router.push('/courier') : router.push('/set-destination')} className="w-28 rounded-xl bg-surfaceMuted p-md active:opacity-70"><Text variant="h3" className="!text-[25px]">{service.icon}</Text><Text variant="bodyMedium" className="mt-sm">{service.label}</Text><Text variant="caption" color="textMuted" numberOfLines={1}>{service.detail}</Text></Pressable>)}
            </ScrollView>
            {user.role === 'rider' ? <><View className="mb-sm flex-row items-center justify-between px-xl">
              <Text variant="bodyMedium">Ride again</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="See all trips" onPress={() => router.push({ pathname: '/account/[section]', params: { section: 'trips' } })}>
                <Text variant="caption" color="primary">See all</Text>
              </Pressable>
            </View>
            {repeatRides.map((ride) => (
              <Pressable
                key={ride.trip.id}
                accessibilityRole="button"
                accessibilityLabel={`${ride.completedCount ? 'Ride again' : 'Try route again'} from ${ride.trip.pickup_address} to ${ride.trip.dropoff_address}`}
                onPress={() => repeatRide(ride)}
                className="mx-xl flex-row items-center gap-md border-t border-border py-sm active:opacity-60"
              >
                <View className="h-10 w-10 items-center justify-center rounded-full bg-surfaceMuted">
                  <Text variant="bodyMedium" color="primary">{ride.completedCount ? '↗' : '↻'}</Text>
                </View>
                <View className="flex-1">
                  <Text variant="bodyMedium" numberOfLines={1}>{ride.trip.dropoff_address}</Text>
                  <Text variant="caption" color="textMuted" numberOfLines={1}>From {ride.trip.pickup_address}</Text>
                </View>
                <Text variant="caption" color="primary">{ride.completedCount ? ride.count > 1 ? `×${ride.count}` : '' : 'Try again'}</Text>
                <Text variant="body" color="icon">›</Text>
              </Pressable>
            ))}
            {ridesLoading && !repeatRides.length ? <Text variant="caption" color="textMuted" className="mx-xl py-sm">Loading your recent rides…</Text> : null}
            {!ridesLoading && !repeatRides.length ? <Pressable onPress={ridesError ? () => setRefreshRides((value) => value + 1) : openDestinationPage} className="mx-xl border-t border-border py-md"><Text variant="caption" color="textMuted">{ridesError ? 'Could not load your rides. Tap to retry.' : 'Your previous ride routes will appear here. Plan your first ride.'}</Text></Pressable> : null}</> : null}
            <View className="mx-xl mt-xs flex-row items-center justify-center gap-sm rounded-lg bg-primarySoft px-md py-sm">
              <Text variant="caption" color="primary">🛡</Text>
              <Text variant="caption" color="primary">Trips are tracked for your safety</Text>
            </View>
          </View></ScrollView>
      </StyledSafeAreaView>
    </View>
  );
}
